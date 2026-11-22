import type { UserInteraction } from '../interactions/types.js'
import type { BlockedOutcome, PausedOutcome, SkippedOutcome } from './types.js'

/**
 * Return-based alternatives to throwing BlockSignal / SkipSignal / PauseSignal.
 * The pipeline fills in `middlewareName` for blocked outcomes.
 */
export function block(reason: string): BlockedOutcome {
  return { kind: 'blocked', middlewareName: '', reason }
}

export function skip(reason?: string): SkippedOutcome {
  return { kind: 'skipped', ...(reason !== undefined ? { reason } : {}) }
}

export function pause(
  interaction: UserInteraction,
  context?: unknown,
): PausedOutcome {
  return {
    kind: 'paused',
    interaction,
    ...(context !== undefined ? { context } : {}),
  }
}
