import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockDriver, DeviceRegistry } from '@opennest/devices'
import {
  createAsk,
  createConfirmationMiddleware,
  DefaultVMEventBus,
  defineSuggestion,
} from '@opennest/vm'
import {
  createAsk as createAskFromIndex,
  defineSuggestion as defineSuggestionFromIndex,
} from './index.js'
import { OpenNestClient } from './client.js'
import type { Device, Middleware, UserInteraction } from '@opennest/vm'

interface MakeClientOptions {
  middleware?: Middleware[]
  onInteraction?: (interaction: UserInteraction) => void | Promise<void>
  onInteractionError?: (error: unknown, interaction: UserInteraction) => void
}

async function makeClient(options: MakeClientOptions = {}): Promise<{
  client: OpenNestClient
  driver: MockDriver
}> {
  const driver = new MockDriver()
  await driver.init({})

  const devices: Device[] = [
    {
      id: 'tv_living_room',
      type: 'tv',
      room: 'living_room',
      name: 'Living Room TV',
      driver,
      driverConfig: {},
    },
    {
      id: 'tv_bedroom',
      type: 'tv',
      room: 'bedroom',
      name: 'Bedroom TV',
      driver,
      driverConfig: {},
    },
    {
      id: 'light_living_room',
      type: 'light',
      room: 'living_room',
      name: 'Living Room Light',
      driver,
      driverConfig: {},
    },
  ]

  driver.seed('tv_living_room', { power: false, volume: 15 })
  driver.seed('tv_bedroom', { power: false, volume: 10 })
  driver.seed('light_living_room', { power: false, brightness: 80 })

  return { client: new OpenNestClient({ devices, ...options }), driver }
}

describe('OpenNestClient', () => {
  it('runs a deterministic program to success', async () => {
    const { client, driver } = await makeClient()

    const result = await client.runDsl('tv[living_room].power = on')

    expect(result.status).toBe('success')
    expect(result.errors).toHaveLength(0)
    expect(result.executed).toHaveLength(1)
    expect(await driver.getProperty('tv_living_room', 'power')).toBe(true)
  })

  it('suspends with awaiting_interaction on ambiguous device', async () => {
    const { client } = await makeClient()

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(result.interaction).not.toBeNull()
    expect(result.interaction!.type).toBe('device_selection')
  })

  it('resumes a pending interaction', async () => {
    const { client, driver } = await makeClient()

    const paused = await client.runDsl('tv.power = on')
    expect(paused.status).toBe('awaiting_interaction')

    const result = await client.resume({
      interactionId: paused.interaction!.id,
      type: 'device_selection',
      deviceId: 'tv_bedroom',
    })

    expect(result.status).toBe('success')
    expect(await driver.getProperty('tv_bedroom', 'power')).toBe(true)
    expect(await driver.getProperty('tv_living_room', 'power')).toBe(false)
  })

  it('round-trips a confirmation interaction', async () => {
    const { client, driver } = await makeClient({
      middleware: [
        createConfirmationMiddleware({ requireConfirmation: () => true }),
      ],
    })

    const paused = await client.runDsl('tv[living_room].power = on')
    expect(paused.status).toBe('awaiting_interaction')
    expect(paused.interaction).not.toBeNull()
    expect(paused.interaction!.type).toBe('confirmation')

    const result = await client.resume({
      interactionId: paused.interaction!.id,
      type: 'confirmation',
      confirmed: true,
    })

    expect(result.status).toBe('success')
    expect(await driver.getProperty('tv_living_room', 'power')).toBe(true)
  })

  it('invokes onInteraction with the pending interaction', async () => {
    const calls: UserInteraction[] = []
    const { client } = await makeClient({
      onInteraction: interaction => calls.push(interaction),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.id).toBe(result.interaction!.id)
    expect(calls[0]!.type).toBe('device_selection')
  })

  it('resolves run() despite a synchronous onInteraction throw', async () => {
    const errors: unknown[] = []
    const { client } = await makeClient({
      onInteraction: () => {
        throw new Error('sync boom')
      },
      onInteractionError: error => errors.push(error),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })

  it('resolves run() despite a rejected onInteraction promise', async () => {
    const errors: unknown[] = []
    const { client } = await makeClient({
      onInteraction: () => Promise.reject(new Error('async boom')),
      onInteractionError: error => errors.push(error),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    await Promise.resolve()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })

  it('routes onInteractionError with (error, interaction)', async () => {
    const thrown = new Error('routed')
    const received: {
      error: unknown
      interaction: UserInteraction
    }[] = []
    const { client } = await makeClient({
      onInteraction: () => {
        throw thrown
      },
      onInteractionError: (error, interaction) =>
        received.push({ error, interaction }),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(received).toHaveLength(1)
    expect(received[0]!.error).toBe(thrown)
    expect(received[0]!.interaction).toBe(result.interaction)
  })

  it('does not await a pending onInteraction promise', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const { client } = await makeClient({
      onInteraction: () => gate,
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    release()
  })

  it('ignores onInteraction errors when onInteractionError is missing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { client } = await makeClient({
        onInteraction: () => {
          throw new Error('boom')
        },
      })

      const result = await client.runDsl('tv.power = on')

      expect(result.status).toBe('awaiting_interaction')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('swallows a throwing onInteractionError on the sync path', async () => {
    const { client } = await makeClient({
      onInteraction: () => {
        throw new Error('sync boom')
      },
      onInteractionError: () => {
        throw new Error('handler boom')
      },
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
  })

  it('swallows a throwing onInteractionError on the async path', async () => {
    const { client } = await makeClient({
      onInteraction: () => Promise.reject(new Error('async boom')),
      onInteractionError: () => {
        throw new Error('handler boom')
      },
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('returns an error when no device matches', async () => {
    const { client } = await makeClient()

    const result = await client.runDsl('camera[living_room].snapshot()')

    expect(result.status).toBe('error')
    expect(result.errors[0]!.message).toContain(
      "No device of type 'camera' found",
    )
  })

  it('exposes the session through getSession', async () => {
    const { client } = await makeClient()

    await client.runDsl('tv[living_room].power = on')

    expect(client.getSession().history).toHaveLength(1)
  })

  it('resets the session on cancel', async () => {
    const { client } = await makeClient()

    await client.runDsl('tv[living_room].power = on')
    expect(client.getSession().history).toHaveLength(1)

    const result = await client.cancel()

    expect(result.status).toBe('success')
    expect(client.getSession().history).toHaveLength(0)
  })

  it('throws ParseError on invalid DSL', async () => {
    const { client } = await makeClient()

    expect(() => client.parse('??? not valid')).toThrow()
  })

  it('rejects with ParseError when runDsl receives invalid DSL', async () => {
    const { client } = await makeClient()

    await expect(client.runDsl('??? not valid')).rejects.toThrow()
  })

  it('accepts a DeviceRegistry as the devices source', async () => {
    const registry = new DeviceRegistry({
      drivers: { mock: {} },
      rooms: ['living_room'],
      devices: [
        {
          id: 'tv_living_room',
          type: 'tv',
          room: 'living_room',
          name: 'Living Room TV',
          driver: 'mock',
          properties: { power: { type: 'boolean' } },
          actions: [],
        },
      ],
    })

    const client = new OpenNestClient({ devices: registry })
    const result = await client.runDsl('tv[living_room].power = on')

    expect(result.status).toBe('success')
    expect(result.executed[0]!.changes[0]!.newValue).toBe(true)
  })

  it('resolves whenReady with a DeviceRegistry source', async () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({ devices: registry })

    await expect(client.whenReady()).resolves.toBeUndefined()
  })

  it('resolves whenReady with no registry (bare Device[])', async () => {
    const { client } = await makeClient()

    await expect(client.whenReady()).resolves.toBeUndefined()
  })

  it('closes the underlying registry drivers', async () => {
    const registry = new DeviceRegistry(makeInventory())
    const driver = registry.getDriver('mock')!
    const spy = vi.spyOn(driver, 'close')
    const client = new OpenNestClient({ devices: registry })

    await client.close()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('resolves close with no registry (bare Device[])', async () => {
    const { client } = await makeClient()

    await expect(client.close()).resolves.toBeUndefined()
  })
})

describe('OpenNestClient pending interactions', () => {
  it('resumes without asking for the interaction id', async () => {
    const { client, driver } = await makeClient()

    const paused = await client.runDsl('tv.power = on')
    expect(paused.status).toBe('awaiting_interaction')

    const pending = client.getPendingInteraction()
    expect(pending).not.toBeNull()
    expect(pending!.id).toBe(paused.interaction!.id)
    expect(pending).toMatchObject({
      type: 'device_selection',
      devices: [{ id: 'tv_living_room' }, { id: 'tv_bedroom' }],
    })

    const result = await client.resumePending({
      type: 'device_selection',
      deviceId: 'tv_living_room',
    })

    expect(result.status).toBe('success')
    expect(result.errors).toHaveLength(0)
    expect(await driver.getProperty('tv_living_room', 'power')).toBe(true)
  })

  it('rejects a type mismatch against the pending interaction', async () => {
    const { client } = await makeClient()

    const paused = await client.runDsl('tv.power = on')
    expect(paused.status).toBe('awaiting_interaction')

    const rejected = await client.resumePending({
      type: 'confirmation',
      confirmed: true,
    })

    expect(rejected.status).toBe('error')
    expect(rejected.errors[0]!.code).toBe('interaction_type_mismatch')
    expect(client.getPendingInteraction()!.id).toBe(paused.interaction!.id)

    const result = await client.resumePending({
      type: 'device_selection',
      deviceId: 'tv_bedroom',
    })
    expect(result.status).toBe('success')
  })

  it('rejects an unknown deviceId and lists the valid ones', async () => {
    const { client } = await makeClient()

    await client.runDsl('tv.power = on')

    const rejected = await client.resumePending({
      type: 'device_selection',
      deviceId: 'unknown',
    })

    expect(rejected.status).toBe('error')
    expect(rejected.errors[0]!.code).toBe('unknown_device_id')
    expect(rejected.errors[0]!.message).toContain('tv_living_room')
    expect(rejected.errors[0]!.message).toContain('tv_bedroom')
  })

  it('rejects resumePending when nothing is pending', async () => {
    const { client } = await makeClient()

    const result = await client.resumePending({
      type: 'device_selection',
      deviceId: 'tv_living_room',
    })

    expect(result.status).toBe('error')
    expect(result.errors[0]!.code).toBe('no_pending_interaction')
    expect(client.getPendingInteraction()).toBeNull()
  })

  it('getPendingInteraction is null after success and after cancel', async () => {
    const { client } = await makeClient()

    // awaiting → cancel() → null
    const first = await client.runDsl('tv.power = on')
    expect(first.status).toBe('awaiting_interaction')
    expect(client.getPendingInteraction()).not.toBeNull()
    const cancelled = await client.cancel()
    expect(cancelled.status).toBe('success')
    expect(client.getPendingInteraction()).toBeNull()

    // awaiting → valid resume → success → null
    const second = await client.runDsl('tv.power = on')
    expect(second.status).toBe('awaiting_interaction')
    const resumed = await client.resumePending({
      type: 'device_selection',
      deviceId: 'tv_living_room',
    })
    expect(resumed.status).toBe('success')
    expect(client.getPendingInteraction()).toBeNull()

    // runDsl success → null
    const third = await client.runDsl('tv[living_room].power = on')
    expect(third.status).toBe('success')
    expect(client.getPendingInteraction()).toBeNull()

    // terminal error on a fresh runDsl → null (no interaction in session)
    const failed = await client.runDsl('camera[living_room].snapshot()')
    expect(failed.status).toBe('error')
    expect(client.getPendingInteraction()).toBeNull()
  })

  it('keeps the pending interaction after a blocked run and still resumes', async () => {
    const { client, driver } = await makeClient()

    const paused = await client.runDsl('tv.power = on')
    expect(paused.status).toBe('awaiting_interaction')

    const blocked = await client.runDsl('tv[living_room].power = on')
    expect(blocked.status).toBe('error')
    expect(blocked.errors[0]!.code).toBe('interaction_pending')
    expect(client.getPendingInteraction()!.id).toBe(paused.interaction!.id)

    const result = await client.resumePending({
      type: 'device_selection',
      deviceId: 'tv_living_room',
    })

    expect(result.status).toBe('success')
    expect(await driver.getProperty('tv_living_room', 'power')).toBe(true)
    expect(client.getPendingInteraction()).toBeNull()
  })

  it('keeps the pending interaction after a failed raw resume', async () => {
    const { client } = await makeClient()

    const paused = await client.runDsl('tv.power = on')
    expect(paused.status).toBe('awaiting_interaction')

    const failed = await client.resume({
      interactionId: 'stale-id',
      type: 'device_selection',
      deviceId: 'tv_living_room',
    })

    expect(failed.status).toBe('error')
    expect(failed.errors[0]!.code).toBe('interaction_id_mismatch')
    expect(client.getPendingInteraction()!.id).toBe(paused.interaction!.id)
  })

  it('clears the pending interaction when a resume continuation throws', async () => {
    const boom = new Error('continuation boom')
    const throwing: Middleware = async ctx => {
      if (ctx.action.device.id === 'tv_bedroom') throw boom
      return { kind: 'execute', actions: [ctx.action] }
    }
    const { client } = await makeClient({ middleware: [throwing] })

    const paused = await client.runDsl('tv.power = on')
    expect(paused.status).toBe('awaiting_interaction')
    expect(client.getPendingInteraction()).not.toBeNull()

    await expect(
      client.resume({
        interactionId: paused.interaction!.id,
        type: 'device_selection',
        deviceId: 'tv_bedroom',
      }),
    ).rejects.toThrow('continuation boom')

    expect(client.getPendingInteraction()).toBeNull()
  })
})

const FROM_YAML = `
drivers:
  mock:
    latency: 0
rooms:
  - living_room
devices:
  - id: tv_living_room
    type: tv
    room: living_room
    name: Living Room TV
    driver: mock
    properties:
      power:
        type: boolean
    actions: []
`

function writeTempYaml(name: string): string {
  const path = join(
    tmpdir(),
    `opennest-sdk-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.yaml`,
  )
  writeFileSync(path, FROM_YAML, 'utf-8')
  return path
}

describe('OpenNestClient.fromYaml', () => {
  it('builds a client from a YAML inventory file', async () => {
    const path = writeTempYaml('client')
    try {
      const client = await OpenNestClient.fromYaml(path)

      const result = await client.runDsl('tv[living_room].power = on')

      expect(result.status).toBe('success')
      expect(result.errors).toHaveLength(0)
      expect(result.executed).toHaveLength(1)
    } finally {
      unlinkSync(path)
    }
  })

  it('forwards middleware and interaction callbacks', async () => {
    const path = writeTempYaml('options')
    try {
      const interactions: UserInteraction[] = []
      const client = await OpenNestClient.fromYaml(path, {
        middleware: [
          createConfirmationMiddleware({ requireConfirmation: () => true }),
        ],
        onInteraction: interaction => interactions.push(interaction),
      })

      const result = await client.runDsl('tv[living_room].power = on')

      expect(result.status).toBe('awaiting_interaction')
      expect(result.interaction!.type).toBe('confirmation')
      expect(interactions).toHaveLength(1)
      expect(interactions[0]!.id).toBe(result.interaction!.id)
    } finally {
      unlinkSync(path)
    }
  })

  it('forwards the eventBus through fromYaml', async () => {
    const path = writeTempYaml('event-bus')
    try {
      const events: string[] = []
      const eventBus = new DefaultVMEventBus()
      eventBus.subscribe(event => events.push(event.kind))

      const client = await OpenNestClient.fromYaml(path, { eventBus })

      const result = await client.runDsl('tv[living_room].power = on')

      expect(result.status).toBe('success')
      expect(events).toContain('program:begin')
      expect(events).toContain('program:end')
    } finally {
      unlinkSync(path)
    }
  })

  it('forwards promptDefinitions through fromYaml', async () => {
    const path = writeTempYaml('prompt-defs')
    try {
      const registry = new DeviceRegistry(makeInventory())
      const client = await OpenNestClient.fromYaml(path, {
        promptDefinitions: registry.getPromptDefinitions(),
      })

      const prompt = client.buildPrompt()

      expect(prompt).toContain('- tv')
      expect(prompt).toContain('- living_room')
    } finally {
      unlinkSync(path)
    }
  })
})

function makeInventory() {
  return {
    drivers: { mock: {} },
    rooms: ['living_room'],
    devices: [
      {
        id: 'tv_living_room',
        type: 'tv',
        room: 'living_room',
        name: 'Living Room TV',
        driver: 'mock',
        properties: { power: { type: 'boolean' } },
        actions: [],
      },
    ],
  } as const
}

describe('OpenNestClient.buildPrompt', () => {
  it('generates a prompt from the registry inventory', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({ devices: registry })

    const prompt = client.buildPrompt()

    expect(prompt).toContain('SUPPORTED DEVICES')
    expect(prompt).toContain('- tv')
    expect(prompt).toContain('- living_room')
  })

  it('injects preamble and custom instruction', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({ devices: registry })

    const prompt = client.buildPrompt({
      preamble: 'You are a HomeDSL translator.',
      customInstruction: 'Output only HomeDSL.',
    })

    expect(prompt).toContain('You are a HomeDSL translator.')
    expect(prompt).toContain('Output only HomeDSL.')
  })

  it('accepts promptDefinitions passed to the constructor', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({
      devices: registry.getDevices(),
      promptDefinitions: registry.getPromptDefinitions(),
    })

    const prompt = client.buildPrompt()

    expect(prompt).toContain('- tv')
  })

  it('throws when built from a bare Device[] with no definitions', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({ devices: registry.getDevices() })

    expect(() => client.buildPrompt()).toThrow(/prompt definitions/)
  })
})

describe('OpenNestClient.analyze', () => {
  it('returns ok with no errors for valid DSL', async () => {
    const { client } = await makeClient()

    const feedback = client.analyze('tv[living_room].power = on')

    expect(feedback.ok).toBe(true)
    expect(feedback.parseErrors).toHaveLength(0)
    expect(feedback.validationErrors).toHaveLength(0)
    expect(feedback.program).not.toBeNull()
  })

  it('returns parse errors without throwing', async () => {
    const { client } = await makeClient()

    const feedback = client.analyze('??? not valid')

    expect(feedback.ok).toBe(false)
    expect(feedback.parseErrors.length).toBeGreaterThan(0)
    expect(feedback.program).toBeNull()
    expect(feedback.validationErrors).toHaveLength(0)
  })

  it('returns validation errors for an unknown device type', async () => {
    const { client } = await makeClient()

    const feedback = client.analyze('camera[living_room].snapshot()')

    expect(feedback.ok).toBe(false)
    expect(feedback.parseErrors).toHaveLength(0)
    expect(feedback.program).not.toBeNull()
    expect(feedback.validationErrors[0]!.message).toContain(
      "No device of type 'camera' found",
    )
  })

  it('validates $it against the current session', async () => {
    const { client } = await makeClient()

    await client.runDsl('tv[living_room].power = on')

    const feedback = client.analyze('$it.power = off')

    expect(feedback.ok).toBe(true)
    expect(feedback.validationErrors).toHaveLength(0)
  })
})

describe('OpenNestClient ask answers', () => {
  const ask = createAsk()
  const volumeMiddleware: Middleware = async (ctx, next) => {
    if (
      ctx.action.kind === 'set_property' &&
      ctx.action.property === 'volume'
    ) {
      const volume = ask(ctx, {
        key: 'volume',
        type: 'number_input',
        message: 'Volume?',
        min: 0,
        max: 100,
      })
      ctx.action.value = { kind: 'number', value: volume }
    }
    return next()
  }

  it('rejects an out-of-range number before calling the VM', async () => {
    const { client, driver } = await makeClient({
      middleware: [volumeMiddleware],
    })
    await client.runDsl('tv[living_room].volume = 1')
    const pending = client.getPendingInteraction()
    expect(pending?.type).toBe('number_input')

    const result = await client.resumePending({
      type: 'number_input',
      value: 101,
    })

    expect(result.status).toBe('error')
    expect(result.errors[0]!.code).toBe('invalid_response')
    expect(client.getPendingInteraction()).toBe(pending)
    expect(await driver.getProperty('tv_living_room', 'volume')).toBe(15)
  })

  it('rejects an unknown choice value', async () => {
    const { client } = await makeClient({
      middleware: [
        async (ctx, next) => {
          ask(ctx, {
            key: 'mode',
            type: 'choice',
            message: 'Mode?',
            options: [{ value: 'cinema', label: 'Cinema' }],
          })
          return next()
        },
      ],
    })
    await client.runDsl('tv[living_room].power = on')

    const result = await client.resumePending({
      type: 'choice',
      value: 'party',
    })

    expect(result.errors[0]!.code).toBe('invalid_response')
    expect(client.getPendingInteraction()?.type).toBe('choice')
  })

  it('rejects an empty text', async () => {
    const { client } = await makeClient({
      middleware: [
        async (ctx, next) => {
          ask(ctx, { key: 'note', type: 'text_input', message: 'Note?' })
          return next()
        },
      ],
    })
    await client.runDsl('tv[living_room].power = on')

    const result = await client.resumePending({
      type: 'text_input',
      text: '   ',
    })

    expect(result.errors[0]!.code).toBe('invalid_response')
    expect(client.getPendingInteraction()?.type).toBe('text_input')
  })

  it('resumes with a valid answer', async () => {
    const { client, driver } = await makeClient({
      middleware: [volumeMiddleware],
    })
    await client.runDsl('tv[living_room].volume = 1')

    const result = await client.resumePending({
      type: 'number_input',
      value: 42,
    })

    expect(result.status).toBe('success')
    expect(await driver.getProperty('tv_living_room', 'volume')).toBe(42)
  })

  it('isolates answers of two clients sharing one ask middleware', async () => {
    const sharedAsk = createAsk()
    const shared: Middleware[] = [
      async (ctx, next) => {
        if (
          ctx.action.kind === 'set_property' &&
          ctx.action.property === 'volume'
        ) {
          const volume = sharedAsk(ctx, {
            key: 'volume',
            type: 'number_input',
            message: 'Volume?',
          })
          ctx.action.value = { kind: 'number', value: volume }
        }
        return next()
      },
    ]
    let askedA = 0
    let askedB = 0
    const a = await makeClient({
      middleware: shared,
      onInteraction: () => {
        askedA++
      },
    })
    const b = await makeClient({
      middleware: shared,
      onInteraction: () => {
        askedB++
      },
    })
    const answer = (value: number) => ({ type: 'number_input', value }) as const

    const a1 = await a.client.runDsl('$t = @all(tv)\n$t.volume = 1')
    expect(a1.status).toBe('awaiting_interaction')
    const b1 = await b.client.runDsl('$t = @all(tv)\n$t.volume = 1')
    expect(b1.status).toBe('awaiting_interaction')

    const a2 = await a.client.resumePending(answer(11))
    expect(a2.status).toBe('awaiting_interaction')
    const b2 = await b.client.resumePending(answer(71))
    expect(b2.status).toBe('awaiting_interaction')
    const a3 = await a.client.resumePending(answer(12))
    const b3 = await b.client.resumePending(answer(72))

    expect(a3.status).toBe('success')
    expect(b3.status).toBe('success')
    expect(await a.driver.getProperty('tv_living_room', 'volume')).toBe(11)
    expect(await a.driver.getProperty('tv_bedroom', 'volume')).toBe(12)
    expect(await b.driver.getProperty('tv_living_room', 'volume')).toBe(71)
    expect(await b.driver.getProperty('tv_bedroom', 'volume')).toBe(72)
    expect(askedA).toBe(2)
    expect(askedB).toBe(2)
  })

  it('re-exports createAsk', () => {
    expect(typeof createAskFromIndex).toBe('function')
  })
})

describe('OpenNestClient suggestions', () => {
  let n = 0
  const modeQuestion = {
    key: 'level',
    type: 'number_input' as const,
    message: 'Volume?',
    min: 0,
    max: 100,
  }

  function setup(names = 1) {
    const defs = Array.from({ length: names }, () =>
      defineSuggestion(`sdk_suggestion_${++n}`, {
        apply: (answer, devices) =>
          devices.map(device => ({
            kind: 'set_property' as const,
            device,
            property: 'volume',
            value: { kind: 'number' as const, value: answer as number },
          })),
      }),
    )
    const middleware: Middleware = async (ctx, next) => {
      if (
        ctx.action.kind === 'set_property' &&
        ctx.action.property === 'power'
      ) {
        for (const [i, def] of defs.entries()) {
          def.suggest(ctx, { ...modeQuestion, key: `level${i}` })
        }
      }
      return next()
    }
    return makeClient({ middleware: [middleware] })
  }

  it('exposes suggestions on the run result and getSuggestions', async () => {
    const { client } = await setup()
    const result = await client.runDsl('tv[living_room].power = on')

    expect(result.suggestions).toHaveLength(1)
    const suggestion = result.suggestions![0]!
    expect(suggestion.question).toEqual({ ...modeQuestion, key: 'level0' })
    expect(suggestion.targets).toEqual([
      {
        id: 'tv_living_room',
        type: 'tv',
        room: 'living_room',
        name: 'Living Room TV',
      },
    ])
    expect(client.getSuggestions()).toEqual(result.suggestions)

    const plain = await makeClient()
    const none = await plain.client.runDsl('tv[living_room].power = on')
    expect(none.suggestions).toBeUndefined()
    expect(plain.client.getSuggestions()).toEqual([])
  })

  it('answers a suggestion end to end', async () => {
    const { client, driver } = await setup()
    const first = await client.runDsl('tv[living_room].power = on')
    const id = first.suggestions![0]!.id

    const result = await client.answerSuggestion(id, {
      type: 'number_input',
      value: 33,
    })

    expect(result.status).toBe('success')
    expect(await driver.getProperty('tv_living_room', 'volume')).toBe(33)
    expect(client.getSuggestions()).toEqual([])
  })

  it('pre-validates suggestion answers without calling the VM', async () => {
    const { client, driver } = await setup()
    const first = await client.runDsl('tv[living_room].power = on')
    const id = first.suggestions![0]!.id

    const unknown = await client.answerSuggestion('nope', {
      type: 'number_input',
      value: 1,
    })
    const mismatch = await client.answerSuggestion(id, {
      type: 'text_input',
      text: 'loud',
    })
    const invalid = await client.answerSuggestion(id, {
      type: 'number_input',
      value: 101,
    })

    expect(unknown.errors[0]!.code).toBe('suggestion_not_found')
    expect(mismatch.errors[0]!.code).toBe('interaction_type_mismatch')
    expect(invalid.errors[0]!.code).toBe('invalid_response')
    for (const r of [unknown, mismatch, invalid]) {
      expect(r.status).toBe('error')
      expect(r.executed).toEqual([])
    }
    expect(await driver.getProperty('tv_living_room', 'volume')).toBe(15)
    expect(client.getSuggestions()).toHaveLength(1)
  })

  it('dismissSuggestion removes one suggestion and keeps siblings', async () => {
    const { client } = await setup(2)
    const first = await client.runDsl('tv[living_room].power = on')
    const [a, b] = first.suggestions!

    expect(client.dismissSuggestion(a!.id)).toBe(true)
    expect(client.dismissSuggestion(a!.id)).toBe(false)
    expect(client.getSuggestions().map(s => s.id)).toEqual([b!.id])
    expect(client.dismissSuggestion(b!.id)).toBe(true)
    expect(client.getSuggestions()).toEqual([])
  })

  it('projects origin on follow-up entries', async () => {
    const { client } = await setup()
    const first = await client.runDsl('tv[living_room].power = on')
    const id = first.suggestions![0]!.id

    const result = await client.answerSuggestion(id, {
      type: 'number_input',
      value: 20,
    })

    expect(result.executed[0]!.origin).toBeUndefined()
    const followUp = result.executed.filter(e => e.origin !== undefined)
    expect(followUp).toHaveLength(1)
    expect(followUp[0]!.origin).toEqual({ suggestionId: id })
  })

  it('re-exports defineSuggestion', () => {
    expect(defineSuggestionFromIndex).toBe(defineSuggestion)
  })
})
