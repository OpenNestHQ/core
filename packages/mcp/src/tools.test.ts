import { describe, expect, it } from 'vitest'
import { MockDriver } from '@opennest/devices'
import { OpenNestClient } from '@opennest/sdk'
import { createConfirmationMiddleware } from '@opennest/vm'
import type { Device } from '@opennest/vm'
import { createGuardedRuntime } from './runtime.js'
import { cancelTool, getSessionTool, respondTool, runDslTool } from './tools.js'
import type { ToolDeps } from './tools.js'

async function makeDeps(): Promise<ToolDeps & { driver: MockDriver }> {
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
      createConfirmationMiddleware({ requireConfirmation: () => true }),
    ],
  })
  return { client, runtime: createGuardedRuntime(client), driver }
}

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
    expect(done.result?.executed.length).toBeGreaterThan(0)
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
    const before = deps.client.getSession()
    const result = await runDslTool(deps, {
      dsl: 'tv[chambre].power = on',
      dryRun: true,
    })
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'validation_error' },
    })
    expect(deps.client.getSession()).toEqual(before)
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
