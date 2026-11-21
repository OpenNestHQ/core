import type { DriverRuntimeContext } from '@opennest/devices'
import type {
  Verification,
  VerificationStrategy,
  PollVerificationStrategy,
  EventVerificationStrategy,
} from '@opennest/lang-core'
import { Cause, Effect, Exit, Option, Queue } from 'effect'
import type { Device } from './types.js'
import { readProperty } from './effect/driver.js'
import type { DriverError } from './effect/errors.js'
import { toOriginalError } from './effect/errors.js'

export const DEFAULT_POLL_TIMEOUT_MS = 2000
export const DEFAULT_POLL_INTERVAL_MS = 200

export interface VerificationTarget {
  kind: 'action' | 'property'
  name: string
}

/** Reads the declarative expected effect of an action from its config, if any. */
export function readExpectedEffects(
  device: Device,
  target: VerificationTarget,
): Record<string, unknown> | undefined {
  if (target.kind !== 'action') return undefined
  const actions = device.driverConfig['actions'] as
    Record<string, { expectedEffects?: Record<string, unknown> }> | undefined
  return actions?.[target.name]?.expectedEffects
}

/**
 * Asks the driver how to observe the state for verification. Falls back to
 * `null` (single immediate observation) when the driver provides no guidance.
 */
export function resolveVerificationStrategy(
  device: Device,
  target: VerificationTarget,
): VerificationStrategy | null {
  return (
    device.driver.getVerificationStrategy?.(
      device.id,
      target.kind,
      target.name,
      device.driverConfig,
    ) ?? null
  )
}

/** Reads the current value of every property in `properties` from the driver. */
export function observeStateEffect(
  device: Device,
  properties: string[],
  runtime: DriverRuntimeContext,
): Effect.Effect<Record<string, unknown>, DriverError> {
  return Effect.gen(function* () {
    const observed: Record<string, unknown> = {}
    for (const property of properties) {
      observed[property] = yield* readProperty(device, property, runtime)
    }
    return observed
  })
}

/** Promise façade of {@link observeStateEffect}; rejects with the driver's error. */
export function observeState(
  device: Device,
  properties: string[],
  runtime: DriverRuntimeContext,
): Promise<Record<string, unknown>> {
  return runRethrowingOriginal(observeStateEffect(device, properties, runtime))
}

/** Compares an observed state against the expected effect (all keys must match). */
export function matchesEffects(
  expected: Record<string, unknown>,
  observed: Record<string, unknown>,
): boolean {
  for (const [property, expectedValue] of Object.entries(expected)) {
    if (normalize(observed[property]) !== normalize(expectedValue)) return false
  }
  return true
}

/**
 * Runs the observation + verification of an expected effect.
 * A `poll` strategy keeps sampling until the state matches or the deadline is
 * reached; an `event` strategy waits for driver notifications; any other (or
 * absent) strategy performs a single observation.
 */
export function verifyStateEffect(
  device: Device,
  expected: Record<string, unknown>,
  strategy: VerificationStrategy | null,
  runtime: DriverRuntimeContext,
): Effect.Effect<Verification, DriverError> {
  const properties = Object.keys(expected)

  if (strategy?.type === 'poll') {
    return pollForEffects(device, properties, expected, strategy, runtime)
  }

  if (strategy?.type === 'event') {
    return waitForStateEvent(device, properties, expected, strategy, runtime)
  }

  return Effect.gen(function* () {
    const observed = yield* observeStateEffect(device, properties, runtime)
    const matched = matchesEffects(expected, observed)
    return buildVerification(
      matched ? 'confirmed' : 'mismatch',
      expected,
      observed,
    )
  })
}

/** Promise façade of {@link verifyStateEffect}; rejects with the driver's error. */
export function verifyState(
  device: Device,
  expected: Record<string, unknown>,
  strategy: VerificationStrategy | null,
  runtime: DriverRuntimeContext,
): Promise<Verification> {
  return runRethrowingOriginal(
    verifyStateEffect(device, expected, strategy, runtime),
  )
}

async function runRethrowingOriginal<A>(
  effect: Effect.Effect<A, DriverError>,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.findErrorOption(exit.cause)
  if (Option.isSome(failure)) throw toOriginalError(failure.value)
  throw Cause.squash(exit.cause)
}

function pollForEffects(
  device: Device,
  properties: string[],
  expected: Record<string, unknown>,
  strategy: PollVerificationStrategy,
  runtime: DriverRuntimeContext,
): Effect.Effect<Verification, DriverError> {
  return Effect.gen(function* () {
    const deadline = Date.now() + strategy.timeout
    let observed = yield* observeStateEffect(device, properties, runtime)

    for (;;) {
      if (matchesEffects(expected, observed)) {
        return buildVerification('confirmed', expected, observed)
      }
      if (Date.now() >= deadline) {
        return buildVerification('timeout', expected, observed)
      }
      yield* Effect.sleep(strategy.interval)
      observed = yield* observeStateEffect(device, properties, runtime)
    }
  })
}

function buildVerification(
  status: Verification['status'],
  expected?: Record<string, unknown>,
  observed?: Record<string, unknown>,
): Verification {
  const verification: Verification = { status }
  if (expected !== undefined) verification.expected = expected
  if (observed !== undefined) verification.observed = observed
  return verification
}

/**
 * Observes immediately, then reacts to driver notifications until the state
 * matches or the deadline passes. Subscriptions and the deadline timer belong
 * to a `Scope`, so they are released on completion and on interruption.
 */
function waitForStateEvent(
  device: Device,
  properties: string[],
  expected: Record<string, unknown>,
  strategy: EventVerificationStrategy,
  runtime: DriverRuntimeContext,
): Effect.Effect<Verification, DriverError> {
  return Effect.scoped(
    Effect.gen(function* () {
      // Immediate observation first: the write may already have been applied.
      let observed = yield* observeStateEffect(device, properties, runtime)
      if (matchesEffects(expected, observed)) {
        return buildVerification('confirmed', expected, observed)
      }

      const deadline = Date.now() + strategy.timeout
      // Each notification (and the deadline) enqueues one "check" wake-up.
      const wakeups = yield* Queue.unbounded<void>()
      const wake = () => void Queue.offerUnsafe(wakeups, undefined)

      let subscribed = 0
      for (const property of properties) {
        const unsubscribe = yield* Effect.acquireRelease(
          Effect.sync(() =>
            device.driver.subscribeProperty?.(
              device.id,
              property,
              device.driverConfig,
              wake,
            ),
          ),
          unsubscribe => Effect.sync(() => unsubscribe?.()),
        )
        if (unsubscribe) subscribed++
      }

      // Not subscribable (down channel or non-push property): fall back to the
      // single observation already taken.
      if (subscribed === 0) {
        return buildVerification('mismatch', expected, observed)
      }

      yield* Effect.forkScoped(
        Effect.sleep(strategy.timeout).pipe(Effect.andThen(Effect.sync(wake))),
      )
      wake()

      for (;;) {
        yield* Queue.take(wakeups)
        if (Date.now() >= deadline) {
          return buildVerification('timeout', expected, observed)
        }
        const next = yield* observeStateEffect(
          device,
          properties,
          runtime,
        ).pipe(Effect.option)
        if (Option.isNone(next)) return buildVerification('not_observable')
        observed = next.value
        if (matchesEffects(expected, observed)) {
          return buildVerification('confirmed', expected, observed)
        }
      }
    }),
  )
}

function normalize(value: unknown): unknown {
  if (value === 'on') return true
  if (value === 'off') return false
  return value
}
