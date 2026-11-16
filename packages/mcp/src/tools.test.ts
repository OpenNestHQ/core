import { describe, expect, it } from 'vitest'
import { MockDriver } from '@opennest/devices'
import { OpenNestClient } from '@opennest/sdk'
import { createConfirmationMiddleware } from '@opennest/vm'
import type { Device } from '@opennest/vm'
import { createGuardedRuntime } from './runtime.js'
import { cancelTool, getSessionTool, respondTool, runDslTool } from './tools.js'
import type { ToolDeps } from './tools.js'
import { toInteractionPrompt } from './result.js'
import { toSessionSummary } from './session.js'

// getSession() returns the live session, so snapshot a detached view.
function snapshot(deps: ToolDeps) {
  const session = deps.client.getSession()
  return structuredClone({
    summary: toSessionSummary(session),
    cursor: session.cursor,
    historyLength: session.history.length,
  })
}

async function makeDeps(
  confirm: (kind: string) => boolean = () => true,
): Promise<ToolDeps & { driver: MockDriver }> {
  const driver = new MockDriver()
  await driver.init({})
  const devices: Device[] = [
    {
      id: 'tv_salon',
      type: 'tv',
      room: 'salon',
      name: 'Salon TV',
      driver,
      driverConfig: {},
    },
  ]
  driver.seed('tv_salon', { power: false, volume: 15 })
  const client = new OpenNestClient({
    devices,
    middleware: [
      createConfirmationMiddleware({
        requireConfirmation: action => confirm(action.kind),
      }),
    ],
  })
  return { client, runtime: createGuardedRuntime(client), driver }
}

function runtimeWaiting(deps: ToolDeps) {
  const pending = deps.client.getPendingInteraction()
  if (pending === null) throw new Error('expected a pending interaction')
  return Promise.resolve(toInteractionPrompt(pending))
}

class FailingDriver extends MockDriver {
  override setProperty(): Promise<void> {
    return Promise.reject(new Error('write refused'))
  }
  override executeAction(): Promise<void> {
    return Promise.reject(new Error('action exploded'))
  }
}

async function makeFailingDeps(): Promise<ToolDeps> {
  const driver = new FailingDriver()
  await driver.init({})
  driver.seed('tv_salon', { power: false })
  const devices: Device[] = [
    {
      id: 'tv_salon',
      type: 'tv',
      room: 'salon',
      name: 'Salon TV',
      driver,
      driverConfig: {},
    },
  ]
  const client = new OpenNestClient({ devices })
  return { client, runtime: createGuardedRuntime(client) }
}

describe('executed scoping (F1)', () => {
  const writesOnly = (kind: string) => kind === 'set_property'

  it('reports exactly one entry for the same program run three times', async () => {
    const deps = await makeDeps(writesOnly)
    for (let i = 0; i < 3; i++) {
      const r = await runDslTool(deps, { dsl: 'tv[salon].power?' })
      if (r.status !== 'completed') throw new Error('expected completed')
      expect(r.result?.executed).toHaveLength(1)
    }
  })

  it('a suspended program reports only its own entries after respond', async () => {
    const deps = await makeDeps(writesOnly)
    await runDslTool(deps, { dsl: 'tv[salon].volume?' })
    const waiting = await runDslTool(deps, {
      dsl: 'tv[salon].volume?\ntv[salon].power = on',
    })
    expect(waiting.status).toBe('waiting_for_user')
    const done = await respondTool(deps, {
      response: { type: 'confirmation', confirmed: true },
    })
    if (done.status !== 'completed') throw new Error('expected completed')
    expect(done.result?.executed).toHaveLength(2)
  })

  it('resets the baseline after cancel', async () => {
    const deps = await makeDeps(writesOnly)
    await runDslTool(deps, { dsl: 'tv[salon].volume?' })
    await runDslTool(deps, { dsl: 'tv[salon].power = on' })
    await cancelTool(deps)
    const r = await runDslTool(deps, { dsl: 'tv[salon].volume?' })
    if (r.status !== 'completed') throw new Error('expected completed')
    expect(r.result?.executed).toHaveLength(1)
  })
})

describe('device failures (F2)', () => {
  it('reports a throwing action as deviceFailures', async () => {
    const deps = await makeFailingDeps()
    const r = await runDslTool(deps, { dsl: 'tv[salon].play()' })
    expect(r).toMatchObject({
      status: 'completed',
      deviceFailures: [{ deviceId: 'tv_salon', message: 'action exploded' }],
    })
  })

  it('reports a throwing property write as deviceFailures (outcomes path)', async () => {
    const deps = await makeFailingDeps()
    const r = await runDslTool(deps, { dsl: 'tv[salon].power = on' })
    expect(r).toMatchObject({
      status: 'completed',
      result: { errors: [] },
      deviceFailures: [{ deviceId: 'tv_salon', message: 'write refused' }],
    })
  })
})

describe('tool handlers', () => {
  it('runs the full confirm loop', async () => {
    const deps = await makeDeps()
    const waiting = await runDslTool(deps, { dsl: 'tv[salon].power = on' })
    expect(waiting.status).toBe('waiting_for_user')
    if (waiting.status !== 'waiting_for_user') return
    expect(waiting.interaction.type).toBe('confirmation')
    expect(waiting.interaction.prompt).toBeTruthy()

    const done = await respondTool(deps, {
      response: { type: 'confirmation', confirmed: true },
    })
    expect(done.status).toBe('completed')
    if (done.status !== 'completed') return
    expect(done.result?.executed).toHaveLength(1)
    expect(done).not.toHaveProperty('deviceFailures')
  })

  it('respond without a pending interaction is blocked', async () => {
    const deps = await makeDeps()
    const result = await respondTool(deps, {
      response: { type: 'confirmation', confirmed: true },
    })
    expect(result).toMatchObject({
      status: 'blocked',
      error: { code: 'no_pending_interaction' },
    })
  })

  it('run_dsl during a pending interaction is blocked', async () => {
    const deps = await makeDeps()
    await runDslTool(deps, { dsl: 'tv[salon].power = on' })
    const result = await runDslTool(deps, { dsl: 'tv[salon].power = off' })
    expect(result).toMatchObject({
      status: 'blocked',
      error: { code: 'interaction_pending' },
    })
  })

  it('dryRun on an invalid program fails with validation_error and no side effects', async () => {
    const deps = await makeDeps()
    const before = snapshot(deps)
    const result = await runDslTool(deps, {
      dsl: 'tv[chambre].power = on',
      dryRun: true,
    })
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'validation_error' },
    })
    expect(snapshot(deps)).toEqual(before)
  })

  it('dryRun on a valid program does not execute or suspend', async () => {
    const deps = await makeDeps()
    const result = await runDslTool(deps, {
      dsl: 'tv[salon].power = on',
      dryRun: true,
    })
    expect(result).toEqual({ status: 'completed' })
    expect(deps.client.getPendingInteraction()).toBeNull()
    expect(await deps.driver.getProperty('tv_salon', 'power')).toBe(false)
  })

  it('cancel and get_session around a suspension', async () => {
    const deps = await makeDeps()
    await runDslTool(deps, { dsl: 'tv[salon].power = on' })

    const during = getSessionTool(deps)
    expect(during.status).toBe('completed')
    if (during.status !== 'completed') return
    expect(during.session?.pendingInteraction).not.toBeNull()
    // Verbatim core prompt, identical to the waiting_for_user result.
    const waiting = await runtimeWaiting(deps)
    expect(during.session?.pendingInteraction).toEqual(waiting)

    expect((await cancelTool(deps)).status).toBe('completed')

    const after = getSessionTool(deps)
    if (after.status !== 'completed') throw new Error('expected completed')
    expect(after.session?.pendingInteraction).toBeNull()
  })

  it('cancel and get_session never throw', async () => {
    const deps = await makeDeps()
    const boom = new Error('boom')
    const broken: ToolDeps = {
      ...deps,
      client: {
        ...deps.client,
        cancel: () => Promise.reject(boom),
        getSession: () => {
          throw boom
        },
      } as unknown as ToolDeps['client'],
    }
    expect(await cancelTool(broken)).toEqual({
      status: 'failed',
      error: { code: 'core_error', message: 'boom' },
    })
    expect(getSessionTool(broken)).toEqual({
      status: 'failed',
      error: { code: 'core_error', message: 'boom' },
    })
  })
})
