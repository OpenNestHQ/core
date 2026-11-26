import type { SuggestionSummary, UserInteraction } from '@opennest/sdk'

/**
 * Shared agent state (AG-UI `STATE_SNAPSHOT` / `STATE_DELTA`). JSON only:
 * the server builds it, the panel renders it.
 */

export type StatementStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'success'
  | 'skipped'
  | 'blocked'
  | 'error'

export interface PanelDevice {
  id: string
  name: string
  room: string
  type: string
  icon: string
  state: Record<string, unknown>
}

export interface PanelStatement {
  index: number
  kind: string
  /** Plain-English label for Basic mode. */
  summary: string
  status: StatementStatus
  devices: { id: string; name: string; icon: string }[]
  resolution?: {
    candidates: number
    matched: number
    excluded: { id: string; reason: string }[]
  }
  outcomes?: { deviceId: string; execution: string; verification: string }[]
  /** e.g. `"confirmation → paused"`. */
  middleware: string[]
  /** Plain-English reason when the statement was blocked or failed. */
  reason?: string
  startedAt?: number
  durationMs?: number
  /** Internal: the write in flight, applied to `devices` once it succeeds. */
  lastWrite?: { deviceId: string; property: string; value: unknown }
}

export interface TraceNode {
  name: string
  kind: string
  status: string
  durationMs?: number
  children: TraceNode[]
}

export type ProgramOrigin = 'chat' | 'dsl' | 'suggestion'

export interface DemoState {
  program: { programId: string; dsl: string; origin: ProgramOrigin } | null
  statements: PanelStatement[]
  trace: TraceNode | null
  pending: {
    interruptId: string
    interaction: UserInteraction
    error?: string
  } | null
  suggestions: SuggestionSummary[]
  devices: PanelDevice[]
  llm: { configured: boolean }
}
