import type { DriverRuntimeContext } from '@opennest/devices'
import type {
  Verification,
  VerificationStrategy,
  PollVerificationStrategy,
  EventVerificationStrategy,
} from '@opennest/lang-core'
import type { Device } from './types.js'

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
export async function observeState(
  device: Device,
  properties: string[],
  runtime: DriverRuntimeContext,
): Promise<Record<string, unknown>> {
  const observed: Record<string, unknown> = {}
  for (const property of properties) {
    observed[property] = await device.driver.getProperty(
      device.id,
      property,
      device.driverConfig,
      runtime,
    )
  }
  return observed
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
 * reached; any other (or absent) strategy performs a single observation.
 */
export async function verifyState(
  device: Device,
  expected: Record<string, unknown>,
  strategy: VerificationStrategy | null,
  runtime: DriverRuntimeContext,
): Promise<Verification> {
  const properties = Object.keys(expected)

  if (strategy?.type === 'poll') {
    return pollForEffects(device, properties, expected, strategy, runtime)
  }

  if (strategy?.type === 'event') {
    return waitForStateEvent(device, properties, expected, strategy, runtime)
  }

  const observed = await observeState(device, properties, runtime)
  const matched = matchesEffects(expected, observed)
  return buildVerification(
    matched ? 'confirmed' : 'mismatch',
    expected,
    observed,
  )
}

async function pollForEffects(
  device: Device,
  properties: string[],
  expected: Record<string, unknown>,
  strategy: PollVerificationStrategy,
  runtime: DriverRuntimeContext,
): Promise<Verification> {
  const deadline = Date.now() + strategy.timeout
  let observed = await observeState(device, properties, runtime)

  for (;;) {
    if (matchesEffects(expected, observed)) {
      return buildVerification('confirmed', expected, observed)
    }
    if (Date.now() >= deadline) {
      return buildVerification('timeout', expected, observed)
    }
    await sleep(strategy.interval)
    observed = await observeState(device, properties, runtime)
  }
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

async function waitForStateEvent(
  device: Device,
  properties: string[],
  expected: Record<string, unknown>,
  strategy: EventVerificationStrategy,
  runtime: DriverRuntimeContext,
): Promise<Verification> {
  // Immediate observation first: the write may already have been applied.
  let observed = await observeState(device, properties, runtime)
  if (matchesEffects(expected, observed)) {
    return buildVerification('confirmed', expected, observed)
  }

  return new Promise<Verification>(resolve => {
    const deadline = Date.now() + strategy.timeout
    const unsubscribers: (() => void)[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined = undefined

    const finish = (verification: Verification): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      for (const unsubscribe of unsubscribers) unsubscribe()
      resolve(verification)
    }

    const check = async (): Promise<void> => {
      if (settled) return
      if (Date.now() >= deadline) {
        finish(buildVerification('timeout', expected, observed))
        return
      }
      try {
        observed = await observeState(device, properties, runtime)
      } catch {
        finish(buildVerification('not_observable'))
        return
      }
      if (matchesEffects(expected, observed)) {
        finish(buildVerification('confirmed', expected, observed))
      }
    }

    for (const property of properties) {
      const unsubscribe = device.driver.subscribeProperty?.(
        device.id,
        property,
        device.driverConfig,
        () => void check(),
      )
      if (unsubscribe) unsubscribers.push(unsubscribe)
    }

    // Not subscribable (down channel or non-push property): fall back to the
    // single observation already taken.
    if (unsubscribers.length === 0) {
      resolve(buildVerification('mismatch', expected, observed))
      return
    }

    timer = setTimeout(() => void check(), strategy.timeout)
    void check()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalize(value: unknown): unknown {
  if (value === 'on') return true
  if (value === 'off') return false
  return value
}
