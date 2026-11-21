import { Cause, Effect, Exit, Option } from 'effect'
import type { VMInfraError } from './errors.js'
import { toOriginalError } from './errors.js'

/**
 * Runs an Effect as a Promise for the façades: a typed failure rejects with the
 * original error object, a defect with its squashed cause.
 */
export async function runPromiseRethrowingOriginal<A>(
  effect: Effect.Effect<A, VMInfraError>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure)) throw toOriginalError(failure.value)
  throw Cause.squash(exit.cause)
}
