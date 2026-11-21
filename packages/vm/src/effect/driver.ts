import { Effect } from 'effect'
import type { DriverRuntimeContext } from '@opennest/devices'
import type { Device } from '../types.js'
import { DriverError } from './errors.js'

type Operation = 'get' | 'set' | 'action'

function combine(
  signal: AbortSignal,
  runtime: DriverRuntimeContext,
): DriverRuntimeContext {
  return {
    ...runtime,
    signal: runtime.signal ? AbortSignal.any([signal, runtime.signal]) : signal,
  }
}

/**
 * Bridges a driver Promise to an Effect. Interruption aborts the signal handed
 * to the driver; `awaitOnInterrupt` additionally makes the interruption wait
 * for the driver promise to settle (writes already sent must run to the end).
 */
function fromDriverPromise<A>(
  device: Device,
  operation: Operation,
  runtime: DriverRuntimeContext,
  call: (runtime: DriverRuntimeContext) => Promise<A>,
  awaitOnInterrupt: boolean,
): Effect.Effect<A, DriverError> {
  return Effect.callback<A, DriverError>((resume, signal) => {
    let lateError: DriverError | undefined
    const toError = (cause: unknown) =>
      new DriverError({ deviceId: device.id, operation, cause })
    let promise: Promise<A>
    try {
      promise = call(combine(signal, runtime))
    } catch (cause) {
      resume(Effect.fail(toError(cause)))
      return
    }
    const settled = promise.then(
      value => {
        resume(Effect.succeed(value))
      },
      cause => {
        // After interruption `resume` is ignored: keep the error so the
        // finalizer below can surface it.
        lateError = toError(cause)
        resume(Effect.fail(lateError))
      },
    )
    if (!awaitOnInterrupt) return undefined
    // Wait for the driver, then re-raise a late rejection. Effect merges a
    // finalizer failure into the interrupt cause, so a caller finds it with
    // `Cause.findErrorOption(exit.cause)` (a DriverError, `cause` = original).
    // The `callback` typing only allows an infallible finalizer, but the
    // runtime does merge its failure into the interrupt cause (verified by
    // the "late rejection" test), hence the cast.
    const finalizer = Effect.promise(() => settled).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          lateError ? Effect.fail(lateError) : Effect.void,
        ),
      ),
    )
    return finalizer as unknown as Effect.Effect<void>
  })
}

export function readProperty(
  device: Device,
  property: string,
  runtime: DriverRuntimeContext,
): Effect.Effect<unknown, DriverError> {
  return fromDriverPromise(
    device,
    'get',
    runtime,
    rt =>
      device.driver.getProperty(device.id, property, device.driverConfig, rt),
    false,
  )
}

export function writeProperty(
  device: Device,
  property: string,
  value: unknown,
  runtime: DriverRuntimeContext,
): Effect.Effect<void, DriverError> {
  return fromDriverPromise(
    device,
    'set',
    runtime,
    rt =>
      device.driver.setProperty(
        device.id,
        property,
        value,
        device.driverConfig,
        rt,
      ),
    true,
  )
}

export function invokeAction(
  device: Device,
  method: string,
  args: Record<string, unknown>,
  runtime: DriverRuntimeContext,
): Effect.Effect<void, DriverError> {
  return fromDriverPromise(
    device,
    'action',
    runtime,
    rt =>
      device.driver.executeAction(
        device.id,
        method,
        args,
        device.driverConfig,
        rt,
      ),
    true,
  )
}
