import { Cause, Data, Deferred, Effect, Exit, Option } from 'effect'
import type { Scope } from 'effect'
import type { VMResult } from '../types.js'

/** A `VMResult` status, plus the one only the Effect entry point produces. */
export type EffectVMStatus = VMResult['status'] | 'interrupted'

export interface EffectVMResult extends Omit<VMResult, 'status'> {
  status: EffectVMStatus
  /** Top-level statements of the program finished before the stop; only when `status === 'interrupted'`. */
  completedStatements?: number
}

/**
 * Raised inside the VM when work is not started, or abandoned, because a stop
 * was requested. It never leaves the interpreter: it ends the statement.
 */
export class StopRequested extends Data.TaggedError('StopRequested') {}

/**
 * Cooperative stop of one program run. The VM checks it before each statement
 * and before each write, and races the side-effect-free sections (reads,
 * verifications) against it.
 */
export interface StopToken {
  readonly isRequested: () => boolean
  /** Fails with `StopRequested` once a stop was requested. */
  readonly check: Effect.Effect<void, StopRequested>
  /**
   * For work without side effects: not started if a stop was requested, and
   * interrupted (not awaited) as soon as one is.
   */
  readonly abandonOnStop: <A, E>(
    self: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | StopRequested>
  /**
   * For a write: not started if a stop was requested. Once started it is
   * interrupted on stop (which aborts the driver signal) and awaited: it
   * succeeds if the driver still completed, or fails with the driver's error.
   */
  readonly abortOnStop: <E>(
    write: Effect.Effect<void, E>,
  ) => Effect.Effect<void, E | StopRequested>
}

/** The token of a run without stop (`executeCommand`): every section runs as is. */
export const neverStop: StopToken = {
  isRequested: () => false,
  check: Effect.void,
  abandonOnStop: self => self,
  abortOnStop: write => write,
}

/**
 * A token requested when `stop` completes. `stop` runs in the surrounding
 * scope, so once the run ends a later stop has no effect.
 */
export function makeStopToken(
  stop: Effect.Effect<void>,
): Effect.Effect<StopToken, never, Scope.Scope> {
  return Effect.gen(function* () {
    const requested = yield* Deferred.make<void>()
    yield* Effect.forkScoped(
      Effect.andThen(stop, Deferred.succeed(requested, undefined)),
    )

    const isRequested = () => Deferred.isDoneUnsafe(requested)
    const check = Effect.suspend(() =>
      isRequested() ? Effect.fail(new StopRequested()) : Effect.void,
    )
    const stopped = Effect.andThen(
      Deferred.await(requested),
      Effect.fail(new StopRequested()),
    )

    return {
      isRequested,
      check,
      abandonOnStop: self =>
        Effect.andThen(check, Effect.raceFirst(self, stopped)),
      abortOnStop: write =>
        Effect.andThen(
          check,
          awaitWriteUntil(write, Deferred.await(requested)),
        ),
    } satisfies StopToken
  })
}

/**
 * Runs `write` until it ends or `requested` completes. In the latter case the
 * write is interrupted, and `raceFirst` waits for its finalizer, i.e. for the
 * driver promise to settle (see `effect/driver.ts`).
 */
function awaitWriteUntil<E>(
  write: Effect.Effect<void, E>,
  requested: Effect.Effect<void>,
): Effect.Effect<void, E | StopRequested> {
  return Effect.gen(function* () {
    let writeExit: Exit.Exit<void, E> | undefined
    const tracked = Effect.onExit(write, exit =>
      Effect.sync(() => {
        writeExit = exit
      }),
    )
    yield* Effect.raceFirst(Effect.exit(tracked), requested)

    // Interrupted before it started: the write was never sent.
    if (writeExit === undefined) return yield* Effect.fail(new StopRequested())
    if (Exit.isSuccess(writeExit)) return
    // A late driver rejection is merged into the interrupt cause.
    const failure = Cause.findErrorOption(writeExit.cause)
    if (Option.isSome(failure)) return yield* Effect.fail(failure.value)
    if (Cause.hasInterruptsOnly(writeExit.cause)) return
    return yield* Effect.failCause(writeExit.cause)
  })
}

/** Narrows the result of a run without stop back to the public `VMResult`. */
export function toVMResult(result: EffectVMResult): VMResult {
  if (result.status === 'interrupted') {
    throw new Error('Unreachable: a run without stop was interrupted')
  }
  return { ...result, status: result.status }
}
