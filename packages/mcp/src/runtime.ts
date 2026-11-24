import type {
  DSLFeedback,
  ResumeAnswer,
  RunResult,
  Session,
  SuggestionResponse,
  SuggestionSummary,
  UserInteraction,
} from '@opennest/sdk'
import { toToolResult } from './result.js'
import type { BlockedCode, ToolResult } from './result.js'

/** Structural subset of `OpenNestClient` consumed by the guarded runtime. */
export interface InteractionClient {
  runDsl(dsl: string): Promise<RunResult>
  analyze(dsl: string): DSLFeedback
  resumePending(answer: ResumeAnswer): Promise<RunResult>
  getPendingInteraction(): UserInteraction | null
  cancel(): Promise<RunResult>
  getSession(): Session
  getSuggestions(): SuggestionSummary[]
  answerSuggestion(id: string, answer: SuggestionResponse): Promise<RunResult>
  dismissSuggestion(id: string): boolean
}

export interface GuardedRuntime {
  runDsl(dsl: string): Promise<ToolResult>
  check(dsl: string): Promise<ToolResult>
  respond(answer: ResumeAnswer): Promise<ToolResult>
  answerSuggestion(id: string, answer: SuggestionResponse): Promise<ToolResult>
}

export const DEFAULT_MAX_FAILED_RESUMES = 2

// State-desync codes are retryable on purpose: they escalate to
// interaction_aborted + cancel() and self-heal instead of deadlocking.
const RETRYABLE_CODES = [
  'interaction_id_mismatch',
  'interaction_type_mismatch',
  'unknown_device_id',
  'no_pending_interaction',
  'no_pending_program',
  'invalid_response',
]

// Codes `answerSuggestion` reports as-is: toToolResult would flatten them
// to `execution_failed`. Only `invalid_response` spends the retry budget.
const SUGGESTION_ERROR_CODES = [
  'suggestion_not_found',
  'suggestion_unavailable',
  'interaction_type_mismatch',
  'invalid_response',
]

const SUGGESTION_ABORT_MESSAGE =
  'Too many invalid answers; this suggestion was dismissed. Other suggestions and the session are unchanged.'
const RUN_DSL_BLOCKED_MESSAGE =
  'Resolve the pending interaction with `respond`, or call `cancel`. `run_dsl` is disabled until then.'
const CHECK_BLOCKED_MESSAGE =
  'Resolve the pending interaction with `respond`, or call `cancel`. `run_dsl` (including `dryRun`) is disabled until then.'
const NO_PENDING_MESSAGE = 'No interaction is pending. Execute a program first.'
const ABORT_MESSAGE =
  'Too many invalid answers; the pending interaction was cancelled. Ask the user again from the start.'
const FIX_PROGRAM_HINT = 'Fix the HomeDSL program and call `run_dsl` again.'

function failedResult(
  code: string,
  message: string,
  hint?: string,
): ToolResult {
  return {
    status: 'failed',
    error: { code, message, ...(hint !== undefined ? { hint } : {}) },
  }
}

function coreErrorResult(error: unknown): ToolResult {
  const message = (error as Error | null | undefined)?.message
  return failedResult('core_error', String(message ?? error))
}

function blockedResult(
  code: BlockedCode,
  message: string,
  interaction: UserInteraction | null,
): ToolResult {
  return {
    status: 'blocked',
    error: {
      code,
      message,
      ...(interaction === null ? {} : { interactionType: interaction.type }),
    },
  }
}

/**
 * Pre-classify a program via `analyze` — `RunResult.errors` carries no
 * provenance, so parse and validation failures can only be told apart before
 * execution. Returns `null` when the program is clean and the run may proceed.
 */
function classifyFeedback(feedback: DSLFeedback): ToolResult | null {
  if (feedback.parseErrors.length > 0) {
    return failedResult(
      'parse_error',
      feedback.parseErrors.map(error => error.message).join('; '),
      FIX_PROGRAM_HINT,
    )
  }
  if (feedback.validationErrors.length > 0) {
    return failedResult(
      'validation_error',
      feedback.validationErrors.map(error => error.message).join('; '),
      FIX_PROGRAM_HINT,
    )
  }
  return null
}

export function createGuardedRuntime(
  client: InteractionClient,
  options?: { maxFailedResumes?: number },
): GuardedRuntime {
  const maxFailedResumes =
    options?.maxFailedResumes ?? DEFAULT_MAX_FAILED_RESUMES
  let failedResumes = 0
  // Invalid-answer counters per suggestion id, separate from `respond`'s.
  const failedSuggestions = new Map<string, number>()
  // Length of `session.history` when the current program started: the SDK's
  // `executed` is the whole history, so results are sliced from here.
  let executedBaseline = 0

  const runDsl = async (dsl: string): Promise<ToolResult> => {
    let pending: UserInteraction | null
    try {
      pending = client.getPendingInteraction()
    } catch (error) {
      return coreErrorResult(error)
    }
    if (pending !== null) {
      return blockedResult(
        'interaction_pending',
        RUN_DSL_BLOCKED_MESSAGE,
        pending,
      )
    }
    let feedback: DSLFeedback
    try {
      feedback = client.analyze(dsl)
    } catch (error) {
      return coreErrorResult(error)
    }
    const preclassified = classifyFeedback(feedback)
    if (preclassified !== null) {
      return preclassified
    }
    let result: RunResult
    try {
      executedBaseline = client.getSession().history.length
      result = await client.runDsl(dsl)
    } catch (error) {
      return coreErrorResult(error)
    }
    failedResumes = 0
    // A new command drops every open suggestion, and their counters.
    failedSuggestions.clear()
    return toToolResult(result, { executedFrom: executedBaseline })
  }

  const check = async (dsl: string): Promise<ToolResult> => {
    let pending: UserInteraction | null
    try {
      pending = client.getPendingInteraction()
    } catch (error) {
      return coreErrorResult(error)
    }
    if (pending !== null) {
      return blockedResult(
        'interaction_pending',
        CHECK_BLOCKED_MESSAGE,
        pending,
      )
    }
    let feedback: DSLFeedback
    try {
      feedback = client.analyze(dsl)
    } catch (error) {
      return coreErrorResult(error)
    }
    const preclassified = classifyFeedback(feedback)
    if (preclassified !== null) {
      return preclassified
    }
    failedResumes = 0
    return { status: 'completed' }
  }

  const respond = async (answer: ResumeAnswer): Promise<ToolResult> => {
    let pending: UserInteraction | null
    try {
      pending = client.getPendingInteraction()
    } catch (error) {
      return coreErrorResult(error)
    }
    if (pending === null) {
      return blockedResult('no_pending_interaction', NO_PENDING_MESSAGE, null)
    }
    let result: RunResult
    try {
      result = await client.resumePending(answer)
    } catch (error) {
      return coreErrorResult(error)
    }
    const code = result.errors[0]?.code
    if (
      result.status === 'error' &&
      code !== undefined &&
      RETRYABLE_CODES.includes(code)
    ) {
      failedResumes += 1
      if (failedResumes > maxFailedResumes) {
        try {
          await client.cancel()
          // The core reset the session: re-read rather than assume 0.
          executedBaseline = client.getSession().history.length
        } catch {
          // cancel is best-effort once the retry budget is exhausted
        }
        failedResumes = 0
        return failedResult('interaction_aborted', ABORT_MESSAGE)
      }
      return failedResult(
        code,
        result.errors.map(error => error.message).join('; '),
      )
    }
    failedResumes = 0
    return toToolResult(result, { executedFrom: executedBaseline })
  }

  const answerSuggestion = async (
    id: string,
    answer: SuggestionResponse,
  ): Promise<ToolResult> => {
    let pending: UserInteraction | null
    try {
      pending = client.getPendingInteraction()
    } catch (error) {
      return coreErrorResult(error)
    }
    if (pending !== null) {
      return blockedResult(
        'interaction_pending',
        'Resolve the pending interaction with `respond`, or call `cancel`. `answer_suggestion` is disabled until then.',
        pending,
      )
    }
    let result: RunResult
    try {
      executedBaseline = client.getSession().history.length
      result = await client.answerSuggestion(id, answer)
    } catch (error) {
      return coreErrorResult(error)
    }
    const code = result.errors[0]?.code
    if (
      result.status === 'error' &&
      code !== undefined &&
      SUGGESTION_ERROR_CODES.includes(code)
    ) {
      const message = result.errors.map(error => error.message).join('; ')
      if (code !== 'invalid_response') {
        failedSuggestions.delete(id)
        return failedResult(code, message)
      }
      const count = (failedSuggestions.get(id) ?? 0) + 1
      if (count > maxFailedResumes) {
        failedSuggestions.delete(id)
        try {
          client.dismissSuggestion(id)
        } catch {
          // dismissal is best-effort once the retry budget is exhausted
        }
        return failedResult('suggestion_aborted', SUGGESTION_ABORT_MESSAGE)
      }
      failedSuggestions.set(id, count)
      return failedResult(code, message)
    }
    failedSuggestions.delete(id)
    return toToolResult(result, { executedFrom: executedBaseline })
  }

  return { runDsl, check, respond, answerSuggestion }
}
