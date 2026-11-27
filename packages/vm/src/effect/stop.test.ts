import { describe, it, expect, vi, afterEach } from 'vitest'
import { Effect } from 'effect'
import { parseHomeDSL } from '@opennest/lang-core'
import type { DeviceDriver, DriverRuntimeContext } from '@opennest/devices'
import { MockDriver } from '@opennest/devices'
import { runCommand } from './index.js'
import type { EffectVMResult, RunOptions } from './index.js'
import { validateProgram } from '../index.js'
import { pause } from '../index.js'
import type { Device, Middleware, VMCommand, VMContext } from '../index.js'
import { DefaultVMEventBus } from '../trace/event-bus.js'
import { DefaultExecutionTracer } from '../trace/tracer.js'
import { NodeStatus } from '../trace/types.js'
import type { ExecutionNode } from '../trace/types.js'

afterEach(() => {
  vi.useRealTimers()
})

function runProgram(source: string): VMCommand & { kind: 'run_program' } {
  const { program, errors } = parseHomeDSL(source)
  expect(errors).toEqual([])
  return { kind: 'run_program', program }
}

/** A stop effect that completes when `trigger` is called. */
function makeStop(): { stop: RunOptions['stop'] & {}; trigger: () => void } {
  let trigger = () => {}
  const fired = new Promise<void>(resolve => {
    trigger = resolve
  })
  return { stop: Effect.promise(() => fired), trigger }
}

function start(
  command: VMCommand,
  context: VMContext,
  options: RunOptions,
): Promise<EffectVMResult> {
  return Effect.runPromise(runCommand(command, context, options))
}

type FakeDriver = DeviceDriver & {
  setProperty: ReturnType<typeof vi.fn<DeviceDriver['setProperty']>>
}

/** A driver whose behaviour is given per test; the rest is inert. */
function makeDriver(overrides: Partial<DeviceDriver>): FakeDriver {
  return {
    name: 'fake',
    async init() {},
    async close() {},
    getProperty: async () => false,
    executeAction: async () => {},
    ...overrides,
    setProperty: vi.fn<DeviceDriver['setProperty']>(
      overrides.setProperty ?? (async () => {}),
    ),
  } as FakeDriver
}

function light(room: string, driver: DeviceDriver): Device {
  return {
    id: `light_${room}`,
    type: 'light',
    room,
    name: `light ${room}`,
    driver,
    driverConfig: {},
  }
}

/** Event verification that never confirms: the run waits until its deadline. */
const neverConfirming = {
  getVerificationStrategy: () => ({ type: 'event' as const, timeout: 10_000 }),
}

function nodes(node: ExecutionNode): ExecutionNode[] {
  return [node, ...node.children.flatMap(nodes)]
}

describe('runCommand with a stop', () => {
  it('stop during verification returns an interrupted result with the write recorded', async () => {
    vi.useFakeTimers()
    const unsubscribe = vi.fn()
    const driver = makeDriver({
      ...neverConfirming,
      subscribeProperty: () => unsubscribe,
    })
    const { stop, trigger } = makeStop()

    const promise = start(
      runProgram('light[living_room].power = on\nlight[bedroom].power = on'),
      { devices: [light('living_room', driver), light('bedroom', driver)] },
      { stop },
    )
    await vi.advanceTimersByTimeAsync(100)
    trigger()
    const result = await promise

    expect(result.status).toBe('interrupted')
    expect(result.completedStatements).toBe(1)
    expect(result.executed).toHaveLength(1)
    expect(result.executed[0]!.outcomes?.[0]?.verification.status).toBe(
      'not_observable',
    )
    const writtenIds = driver.setProperty.mock.calls.map(call => call[0])
    expect(writtenIds).toEqual(['light_living_room'])
    expect(vi.getTimerCount()).toBe(0)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('stop during an @all batch keeps sent writes and skips the rest of the program', async () => {
    vi.useFakeTimers()
    const driver = makeDriver({
      ...neverConfirming,
      subscribeProperty: () => () => {},
      // Ignores its signal: the write always completes after 20 ms.
      setProperty: () => new Promise(resolve => setTimeout(resolve, 20)),
    })
    const { stop, trigger } = makeStop()

    const promise = start(
      runProgram(
        '$lights = @all(light[*])\n$lights.power = on\nlight[living_room].power = off',
      ),
      {
        devices: [
          light('living_room', driver),
          light('bedroom', driver),
          light('kitchen', driver),
        ],
      },
      { stop },
    )
    await vi.advanceTimersByTimeAsync(10)
    trigger()
    await vi.advanceTimersByTimeAsync(10)
    const result = await promise

    expect(result.status).toBe('interrupted')
    // The variable assignment and the batch ran; the last statement did not.
    expect(result.completedStatements).toBe(2)
    expect(result.executed).toHaveLength(2)
    expect(result.executed[1]!.changes.map(c => c.deviceId).sort()).toEqual([
      'light_bedroom',
      'light_kitchen',
      'light_living_room',
    ])
    expect(driver.setProperty).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop while a write is queued in the driver aborts it', async () => {
    const driver = makeDriver({
      // Queued until aborted (e.g. a WS socket reconnecting).
      setProperty: (
        _id,
        _prop,
        _value,
        _config,
        runtime?: DriverRuntimeContext,
      ) =>
        new Promise<void>((_resolve, reject) => {
          runtime?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          )
        }),
    })
    const { stop, trigger } = makeStop()

    const promise = start(
      runProgram('light[living_room].power = on'),
      { devices: [light('living_room', driver)] },
      { stop },
    )
    await vi.waitFor(() => expect(driver.setProperty).toHaveBeenCalled())
    trigger()
    const result = await promise

    expect(result.status).toBe('interrupted')
    expect(result.executed[0]!.outcomes?.[0]?.execution.status).toBe('failed')
  })

  it('stop with a driver ignoring the signal on reads still returns', async () => {
    const getProperty = vi.fn(() => new Promise<unknown>(() => {}))
    const driver = makeDriver({ getProperty })
    const { stop, trigger } = makeStop()

    const promise = start(
      runProgram(
        '@if light[living_room].power? == on\nlight[living_room].power = off\n@endif',
      ),
      { devices: [light('living_room', driver)] },
      { stop },
    )
    await vi.waitFor(() => expect(getProperty).toHaveBeenCalled())
    trigger()
    const result = await promise

    expect(result.status).toBe('interrupted')
    expect(result.completedStatements).toBe(0)
    expect(result.executed).toEqual([])
    expect(driver.setProperty).not.toHaveBeenCalled()
  })

  it('stop after completion or while awaiting interaction has no effect', async () => {
    const mock = new MockDriver()
    await mock.init({})
    mock.seed('light_living_room', { power: false })
    mock.seed('light_bedroom', { power: false })
    const devices = [light('living_room', mock), light('bedroom', mock)]

    const completed = makeStop()
    const success = await start(
      runProgram('light[living_room].power = on'),
      { devices },
      { stop: completed.stop },
    )
    completed.trigger()

    const pending = makeStop()
    const awaiting = await start(
      runProgram('light.power = on'),
      { devices },
      { stop: pending.stop },
    )
    pending.trigger()

    expect(success.status).toBe('success')
    expect(success.completedStatements).toBeUndefined()
    expect(awaiting.status).toBe('awaiting_interaction')
    expect(awaiting.session.pendingInteraction).not.toBeNull()
  })

  it('an interrupted session can run a new program from scratch', async () => {
    vi.useFakeTimers()
    const driver = makeDriver({
      ...neverConfirming,
      subscribeProperty: () => () => {},
    })
    const devices = [light('living_room', driver), light('bedroom', driver)]
    const { stop, trigger } = makeStop()
    const promise = start(
      runProgram('light[living_room].power = on\nlight[bedroom].power = on'),
      { devices },
      { stop },
    )
    await vi.advanceTimersByTimeAsync(100)
    trigger()
    const interrupted = await promise
    expect(interrupted.status).toBe('interrupted')
    expect(interrupted.session.cursor).toBe(0)
    expect(interrupted.session._pendingProgram).toBeUndefined()
    expect(interrupted.session.pendingInteraction).toBeNull()

    const next = runProgram(
      'light[living_room].power = off\ntv[living_room].power = on',
    )
    const result = await Effect.runPromise(
      runCommand(next, { devices, session: interrupted.session }),
    )

    expect(result.status).toBe('error')
    expect(result.errors).toEqual(validateProgram(next.program, devices))
  })

  it('trace closes every node as Interrupted', async () => {
    const getProperty = vi.fn(() => new Promise<unknown>(() => {}))
    const driver = makeDriver({ getProperty })
    const tracer = new DefaultExecutionTracer()
    const eventBus = new DefaultVMEventBus(tracer)
    const { stop, trigger } = makeStop()

    const promise = start(
      runProgram('light[living_room].power = on'),
      { devices: [light('living_room', driver)], eventBus },
      { stop },
    )
    await vi.waitFor(() => expect(getProperty).toHaveBeenCalled())
    trigger()
    const result = await promise

    const { root } = tracer.getTrace()
    expect(result.status).toBe('interrupted')
    expect(nodes(root).map(n => n.status)).toEqual([
      NodeStatus.Interrupted,
      NodeStatus.Interrupted,
      NodeStatus.Interrupted,
    ])
    expect(driver.setProperty).not.toHaveBeenCalled()
  })

  it('a stop already complete at start sends nothing', async () => {
    const getProperty = vi.fn(async () => false)
    const driver = makeDriver({ getProperty })

    const result = await start(
      runProgram('light[living_room].power = on'),
      { devices: [light('living_room', driver)] },
      { stop: Effect.void },
    )

    expect(result.status).toBe('interrupted')
    expect(result.completedStatements).toBe(0)
    expect(result.executed).toEqual([])
    expect(getProperty).not.toHaveBeenCalled()
    expect(driver.setProperty).not.toHaveBeenCalled()
  })

  it('a stop requested before the run suspends ends it as interrupted', async () => {
    const driver = makeDriver({})
    let release = () => {}
    const released = new Promise<void>(resolve => {
      release = resolve
    })
    let entered = false
    // Async middleware: waits, then asks for a confirmation.
    const confirmLater: Middleware = async () => {
      entered = true
      await released
      return pause({ id: 'confirm-1', type: 'confirmation', message: 'ok?' })
    }
    const { stop, trigger } = makeStop()

    const promise = start(
      runProgram('light[living_room].power = on'),
      { devices: [light('living_room', driver)], middleware: [confirmLater] },
      { stop },
    )
    await vi.waitFor(() => expect(entered).toBe(true))
    trigger()
    // Let the stop fiber complete before the middleware resumes.
    await new Promise(resolve => setTimeout(resolve, 0))
    release()
    const result = await promise

    expect(result.status).toBe('interrupted')
    expect(result.interaction).toBeNull()
    expect(result.session.pendingInteraction).toBeNull()
    expect(result.session._pendingProgram).toBeUndefined()
    expect(result.session.cursor).toBe(0)
    expect(driver.setProperty).not.toHaveBeenCalled()
  })

  it('a stop during a batch records only the sent elements', async () => {
    const hungRead = new Promise<unknown>(() => {})
    const driver = makeDriver({
      // The kitchen light never answers its pre-write read.
      getProperty: async (id: string) =>
        id === 'light_kitchen' ? hungRead : false,
    })
    const { stop, trigger } = makeStop()

    const promise = start(
      runProgram('$lights = @all(light[*])\n$lights.power = on'),
      {
        devices: [
          light('living_room', driver),
          light('bedroom', driver),
          light('kitchen', driver),
        ],
      },
      { stop },
    )
    await vi.waitFor(() => expect(driver.setProperty).toHaveBeenCalledTimes(2))
    trigger()
    const result = await promise

    expect(result.status).toBe('interrupted')
    expect(result.completedStatements).toBe(1)
    const batch = result.executed[1]!
    expect(batch.changes.map(c => c.deviceId).sort()).toEqual([
      'light_bedroom',
      'light_living_room',
    ])
    expect(batch.resolvedDevices.map(d => d.id).sort()).toEqual([
      'light_bedroom',
      'light_living_room',
    ])
    expect(['light_bedroom', 'light_living_room']).toContain(
      result.session.it?.id,
    )
  })
})
