/** Status of the command execution itself (did the driver accept it?). */
export type ExecutionStatus = 'accepted' | 'failed'

export interface ActionExecution {
  status: ExecutionStatus
  /** Present only when the driver rejected the command. */
  error?: string
}

/** Result of comparing the observed state against the expected effect. */
export type VerificationStatus =
  'confirmed' | 'mismatch' | 'not_observable' | 'timeout'

export interface Verification {
  status: VerificationStatus
  /** Expected effect (property → value). Absent when not observable. */
  expected?: Record<string, unknown>
  /** Actually observed state (property → value). Absent when not observable. */
  observed?: Record<string, unknown>
}

/**
 * Structured conclusion of executing an action (or state-changing write).
 * Distinguishes the command execution from the state verification, instead of
 * collapsing everything into a single success/failure boolean.
 */
export interface ActionOutcome {
  deviceId: string
  execution: ActionExecution
  verification: Verification
}

/** How the runtime should observe the device state to verify an effect. */
export type VerificationStrategy =
  PollVerificationStrategy | EventVerificationStrategy

export interface PollVerificationStrategy {
  type: 'poll'
  timeout: number
  interval: number
}

/**
 * Reserved for future event/subscription-based verification. The runtime does
 * not implement it yet — it is declared so drivers can opt into it later.
 */
export interface EventVerificationStrategy {
  type: 'event'
}
