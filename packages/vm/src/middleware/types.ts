import type { Value } from '@opennest/lang-core'
import type { Device, Session } from '../types.js'
import type { UserInteraction } from '../interactions/types.js'

// ── PlannedAction (unchanged) ──

export type PlannedAction =
  | SetPropertyAction
  | IncrementPropertyAction
  | ReadPropertyAction
  | InvokeActionAction

export interface SetPropertyAction {
  kind: 'set_property'
  device: Device
  property: string
  value: Value
}

export interface IncrementPropertyAction {
  kind: 'increment_property'
  device: Device
  property: string
  value: Value
}

export interface ReadPropertyAction {
  kind: 'read_property'
  device: Device
  property: string
}

export interface InvokeActionAction {
  kind: 'invoke_action'
  device: Device
  method: string
  args?: Record<string, Value>
}

// ── Signals (throw-based flow control) ──

export class BlockSignal extends Error {
  constructor(public reason: string) {
    super(reason)
    this.name = 'BlockSignal'
  }
}

export class SkipSignal extends Error {
  constructor(public reason?: string) {
    super(reason ?? 'skipped')
    this.name = 'SkipSignal'
  }
}

export class PauseSignal extends Error {
  constructor(
    public interaction: UserInteraction,
    public context?: unknown,
  ) {
    super('paused')
    this.name = 'PauseSignal'
  }
}

export class ExpandSignal extends Error {
  constructor(public actions: PlannedAction[]) {
    super('expanded')
    this.name = 'ExpandSignal'
  }
}

// ── Middleware context and type ──

export interface MiddlewareContext {
  action: PlannedAction
  session: Session
  devices: Device[]
}

export type Middleware = (
  ctx: MiddlewareContext,
  next: () => Promise<PipelineOutcome>,
) => Promise<PipelineOutcome>

// ── PipelineOutcome (unchanged) ──

export type PipelineOutcome =
  ExecuteOutcome | BlockedOutcome | SkippedOutcome | PausedOutcome

export interface ExecuteOutcome {
  kind: 'execute'
  actions: PlannedAction[]
}

export interface BlockedOutcome {
  kind: 'blocked'
  middlewareName: string
  reason: string
}

export interface SkippedOutcome {
  kind: 'skipped'
  reason?: string
}

export interface PausedOutcome {
  kind: 'paused'
  interaction: UserInteraction
  context?: unknown
}
