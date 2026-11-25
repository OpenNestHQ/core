import type { Value } from '@opennest/lang-core'
import type { Device } from '../types.js'
import type { MiddlewareContext, PlannedAction } from '../middleware/types.js'

export type SuggestionQuestion =
  | { key: string; type: 'text_input'; message: string; placeholder?: string }
  | {
      key: string
      type: 'number_input'
      message: string
      min?: number
      max?: number
    }
  | {
      key: string
      type: 'choice'
      message: string
      options: { value: string; label: string }[]
    }

/** `number_input` → `number`; `text_input` and `choice` (the option value) → `string`. */
export type SuggestionAnswer<Q extends SuggestionQuestion> = Q extends {
  type: 'number_input'
}
  ? number
  : string

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export interface SuggestionApply {
  (
    answer: string | number,
    devices: Device[],
    data: JsonValue | undefined,
  ): PlannedAction[] | Promise<PlannedAction[]>
}

export interface SuggestionDefinition {
  readonly name: string
  suggest(
    ctx: MiddlewareContext,
    question: SuggestionQuestion & { data?: JsonValue },
  ): void
}

/** A suggestion offered after a successful run; plain JSON, stored in the session. */
export interface OpenSuggestion {
  id: string
  name: string
  question: SuggestionQuestion
  /** Device ids whose action was accepted, unique, in first-seen order. */
  targets: string[]
  data?: JsonValue
}

/** Internal: a suggestion being collected during a run. */
export interface SuggestionCandidate {
  programId: string
  cursor: number
  name: string
  question: SuggestionQuestion
  data?: JsonValue
  /** Targets offered by `suggest`, not yet known to be accepted. */
  pending: string[]
  /** Targets whose action was accepted. */
  confirmed: string[]
}

/** An answer to an open suggestion (same shapes as the 4a responses, without `interactionId`). */
export type SuggestionResponse =
  | { type: 'text_input'; text: string }
  | { type: 'number_input'; value: number }
  | { type: 'choice'; value: string }

/** Error codes of `answer_suggestion` besides the reused interaction ones. */
export type SuggestionErrorCode =
  'suggestion_not_found' | 'suggestion_unavailable'

/** One operation of a follow-up run (plain data): the same write on `deviceIds`. */
export interface FollowUpStep {
  kind: 'set_property' | 'increment_property' | 'invoke_action'
  deviceIds: string[]
  property?: string
  method?: string
  value?: Value
  args?: Record<string, Value>
}

/** Internal: a follow-up run in progress (`cursor` is the current step). */
export interface PendingFollowUp {
  suggestionId: string
  steps: FollowUpStep[]
}
