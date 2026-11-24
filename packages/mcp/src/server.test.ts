import { describe, expect, it } from 'vitest'
import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
} from '@modelcontextprotocol/server'
import type { JSONRPCMessage } from '@modelcontextprotocol/server'
import type { RunResult, Session } from '@opennest/sdk'
import { createOpenNestServer } from './server.js'
import type { OpenNestServerOptions } from './server.js'

const REFERENCE = '# Référence HomeDSL\n@all(light[salon])'

const OK: RunResult = {
  status: 'success',
  executed: [],
  errors: [],
  interaction: null,
} as unknown as RunResult

function stubClient(
  runDsl: (dsl: string) => Promise<RunResult> = async () => OK,
  buildPrompt: () => string = () => REFERENCE,
): OpenNestServerOptions['client'] {
  return {
    runDsl,
    analyze: () => ({ parseErrors: [], validationErrors: [] }),
    resumePending: async () => OK,
    getPendingInteraction: () => null,
    cancel: async () => OK,
    getSuggestions: () => [],
    answerSuggestion: async () => OK,
    dismissSuggestion: () => false,
    getSession: () =>
      ({
        programId: 'p',
        variables: {},
        argVariables: {},
        it: null,
        history: [],
        cursor: 0,
        resolvedIds: {},
        variableResolvedIds: {},
        variableModifiers: {},
        pendingInteraction: null,
      }) as unknown as Session,
    buildPrompt,
  } as unknown as OpenNestServerOptions['client']
}

// Untyped JSON-RPC payloads: the test client is deliberately minimal.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = any

const DEVICES = [{ id: 'tv_salon', type: 'tv', room: 'salon', name: 'TV' }]

// Minimal JSON-RPC client: the library is server-only.
async function connect(options: OpenNestServerOptions) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const server = createOpenNestServer(options)
  await server.connect(serverSide)
  const pending = new Map<number, (message: Rpc) => void>()
  clientSide.onmessage = (message: JSONRPCMessage) => {
    const id = (message as { id?: number }).id
    if (id !== undefined) pending.get(id)?.(message)
  }
  await clientSide.start()
  let nextId = 1
  const request = (method: string, params: object = {}) =>
    new Promise<Rpc>(resolve => {
      const id = nextId++
      pending.set(id, resolve)
      void clientSide.send({ jsonrpc: '2.0', id, method, params })
    })
  const init = await request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  })
  await clientSide.send({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  })
  return {
    init: init.result,
    request,
    close: async () => {
      await clientSide.close()
      await server.close()
    },
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 20))

describe('createOpenNestServer', () => {
  it('lists exactly the five tools with input schemas and annotations', async () => {
    const c = await connect({ client: stubClient(), devices: DEVICES })
    const { result } = await c.request('tools/list')
    expect(result.tools.map((t: Rpc) => t.name)).toEqual([
      'run_dsl',
      'respond',
      'answer_suggestion',
      'cancel',
      'get_session',
    ])
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe('object')
    }
    const byName = Object.fromEntries(result.tools.map((t: Rpc) => [t.name, t]))
    expect(byName.get_session.annotations.readOnlyHint).toBe(true)
    expect(byName.cancel.annotations.idempotentHint).toBe(true)
    expect(byName.run_dsl.annotations.destructiveHint).toBe(true)
    await c.close()
  })

  it('advertises the reference in instructions and calls buildPrompt once', async () => {
    let calls = 0
    const c = await connect({
      client: stubClient(undefined, () => {
        calls++
        return REFERENCE
      }),
      devices: DEVICES,
    })
    expect(c.init.instructions).toContain(REFERENCE)
    await c.request('resources/read', { uri: 'opennest://dsl-reference' })
    expect(calls).toBe(1)
    await c.close()
  })

  it('serves both resources', async () => {
    const c = await connect({ client: stubClient(), devices: DEVICES })
    const ref = await c.request('resources/read', {
      uri: 'opennest://dsl-reference',
    })
    expect(ref.result.contents[0].text).toBe(REFERENCE)
    const dev = await c.request('resources/read', {
      uri: 'opennest://devices',
    })
    expect(JSON.parse(dev.result.contents[0].text)).toEqual(DEVICES)
    await c.close()
  })

  it('round-trips run_dsl as structuredContent without interactionId, never isError', async () => {
    const c = await connect({ client: stubClient(), devices: DEVICES })
    const calls = [
      await c.request('tools/call', {
        name: 'run_dsl',
        arguments: { dsl: 'light[salon].power = on' },
      }),
      await c.request('tools/call', {
        name: 'run_dsl',
        arguments: { dsl: 'light[salon].power = on', dryRun: true },
      }),
      await c.request('tools/call', { name: 'get_session', arguments: {} }),
      await c.request('tools/call', {
        name: 'respond',
        arguments: { response: { type: 'confirmation', confirmed: true } },
      }),
    ]
    expect(calls[0].result.structuredContent.status).toBe('completed')
    expect(calls[1].result.structuredContent).toEqual({ status: 'completed' })
    expect(calls[2].result.structuredContent.session).toBeDefined()
    expect(calls[3].result.structuredContent.status).toBe('blocked')
    for (const call of calls) {
      expect(call.result.isError).toBeUndefined()
      expect(JSON.parse(call.result.content[0].text)).toEqual(
        call.result.structuredContent,
      )
    }
    expect(JSON.stringify(calls)).not.toContain('interactionId')
    await c.close()
  })

  it('serializes tool calls (second starts only after first resolves)', async () => {
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => (release = resolve))
    let n = 0
    const client = stubClient(async dsl => {
      events.push(`start:${dsl}`)
      if (n++ === 0) await gate
      events.push(`end:${dsl}`)
      return OK
    })
    const c = await connect({ client, devices: DEVICES })
    const first = c.request('tools/call', {
      name: 'run_dsl',
      arguments: { dsl: 'a' },
    })
    const second = c.request('tools/call', {
      name: 'run_dsl',
      arguments: { dsl: 'b' },
    })
    await tick()
    expect(events).toEqual(['start:a'])
    release()
    const [r1, r2] = await Promise.all([first, second])
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    expect(r1.result.structuredContent.status).toBe('completed')
    expect(r2.result.structuredContent.status).toBe('completed')
    await c.close()
  })

  it('keeps serving after a handler throws', async () => {
    let n = 0
    const client = stubClient()
    client.getSession = () => {
      if (n++ === 0) throw new Error('boom')
      return stubClient().getSession()
    }
    const c = await connect({ client, devices: DEVICES })
    const a = await c.request('tools/call', {
      name: 'get_session',
      arguments: {},
    })
    expect(a.result.structuredContent.error.code).toBe('core_error')
    const b = await c.request('tools/call', {
      name: 'get_session',
      arguments: {},
    })
    expect(b.result.structuredContent.status).toBe('completed')
    await c.close()
  })
})
