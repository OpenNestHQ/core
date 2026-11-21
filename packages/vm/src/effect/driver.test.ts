import { describe, expect, it } from 'vitest'
import { Cause, Effect, Exit, Fiber } from 'effect'
import type { DeviceDriver } from '@opennest/devices'
import type { Device } from '../types.js'
import { invokeAction, readProperty, writeProperty } from './driver.js'
import { toOriginalError } from './errors.js'

function makeDevice(driver: Partial<DeviceDriver>): Device {
  return {
    id: 'd1',
    type: 'light',
    room: 'salon',
    name: 'Lamp',
    driver: driver as DeviceDriver,
    driverConfig: {},
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe('effect driver adapters', () => {
  it('readProperty maps a rejection to DriverError with the original cause', async () => {
    const err = new Error('boom')
    const device = makeDevice({ getProperty: () => Promise.reject(err) })
    const exit = await Effect.runPromiseExit(
      readProperty(device, 'power', { programId: 'p' }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      const e = failure._tag === 'Some' ? failure.value : undefined
      expect(e?._tag).toBe('DriverError')
      expect(e?.operation).toBe('get')
      expect(e?.cause).toBe(err)
      expect(e && toOriginalError(e)).toBe(err)
    }
  })

  it('interrupting readProperty aborts the signal and does not wait', async () => {
    let seen: AbortSignal | undefined
    const device = makeDevice({
      getProperty: (_i, _p, _c, runtime) => {
        seen = runtime?.signal
        return new Promise(() => {})
      },
    })
    const fiber = Effect.runFork(
      readProperty(device, 'power', { programId: 'p' }),
    )
    await sleep(10)
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(seen?.aborted).toBe(true)
  })

  it('interrupting writeProperty aborts the signal but waits for the driver', async () => {
    let seen: AbortSignal | undefined
    let resolveDriver: () => void = () => {}
    const device = makeDevice({
      setProperty: (_i, _p, _v, _c, runtime) => {
        seen = runtime?.signal
        return new Promise<void>(r => {
          resolveDriver = r
        })
      },
    })
    const fiber = Effect.runFork(
      writeProperty(device, 'power', true, { programId: 'p' }),
    )
    await sleep(10)
    let interrupted = false
    const interruption = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      interrupted = true
    })
    await sleep(50)
    expect(seen?.aborted).toBe(true)
    expect(interrupted).toBe(false)
    resolveDriver()
    await interruption
    expect(interrupted).toBe(true)
  })

  it('invokeAction interruption waits for a late rejection', async () => {
    const err = new Error('late')
    const device = makeDevice({
      executeAction: () => sleep(20).then(() => Promise.reject(err)),
    })
    const fiber = Effect.runFork(
      invokeAction(device, 'toggle', {}, { programId: 'p' }),
    )
    await sleep(5)
    const start = Date.now()
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(Date.now() - start).toBeGreaterThanOrEqual(10)
    const exit = await Effect.runPromiseExit(Fiber.join(fiber))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('runtime.signal already aborted aborts the driver signal', async () => {
    let seen: AbortSignal | undefined
    const device = makeDevice({
      getProperty: (_i, _p, _c, runtime) => {
        seen = runtime?.signal
        return Promise.resolve(1)
      },
    })
    await Effect.runPromiseExit(
      readProperty(device, 'power', {
        programId: 'p',
        signal: AbortSignal.abort(),
      }),
    )
    expect(seen?.aborted).toBe(true)
  })
})
