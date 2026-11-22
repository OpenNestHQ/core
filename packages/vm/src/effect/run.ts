import { Cause, Effect, Exit, Option } from 'effect'
import { DriverError, MiddlewareError, toOriginalError } from './errors.js'

/**
 * Runs an Effect as a Promise for the façades: a typed `VMInfraError` rejects
 * with the original error object, any other typed failure (e.g. an
 * `InteractionError`) with itself, and a defect with its squashed cause.
 */
export async function runPromiseRethrowingOriginal<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure)) {
    const error = failure.value
    throw error instanceof DriverError || error instanceof MiddlewareError
      ? toOriginalError(error)
      : error
  }
  throw Cause.squash(exit.cause)
}
