import { Data } from 'effect'

/** A DeviceDriver call (get/set/action) rejected. `cause` is the original error. */
export class DriverError extends Data.TaggedError('DriverError')<{
  readonly deviceId: string
  readonly operation: 'get' | 'set' | 'action'
  readonly cause: unknown
}> {}

/** A middleware threw something that is not a flow-control signal. */
export class MiddlewareError extends Data.TaggedError('MiddlewareError')<{
  readonly middlewareName: string
  readonly cause: unknown
}> {}

export type VMInfraError = DriverError | MiddlewareError

/** The original error, for Promise facades that rethrow what the driver threw. */
export function toOriginalError(error: VMInfraError): unknown {
  return error.cause
}
