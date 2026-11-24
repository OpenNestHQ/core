import type {
  RunResult,
  SuggestionSummary,
  UserInteraction,
} from '@opennest/sdk'
import type { MissingParameter } from '@opennest/vm'
import type { SessionSummary } from './session.js'

/** A single selectable option exposed to the agent (device or choice id). */
export interface InteractionChoice {
  id: string
  label: string
}

/** Agent-facing projection of a missing action parameter. */
export interface MissingParameterSummary {
  name: string
  type: 'string' | 'number' | 'power' | 'enum'
  values?: string[]
}

/**
 * Self-contained description of a pending user interaction. Interaction ids
 * are deliberately omitted: `respond` auto-targets the single pending
 * interaction, so agents never need to track or echo an id. `choices[].id`
 * values (device or option ids) are legitimate and preserved.
 */
export type InteractionPrompt =
  | { type: 'device_selection'; prompt: string; choices: InteractionChoice[] }
  | { type: 'confirmation'; prompt: string }
  | { type: 'text_input'; prompt: string; placeholder?: string }
  | {
      type: 'number_input'
      prompt: string
      min?: number
      max?: number
      step?: number
    }
  | { type: 'choice'; prompt: string; choices: InteractionChoice[] }
  | {
      type: 'action_parameter'
      prompt: string
      missing: MissingParameterSummary[]
    }

/**
 * Agent-facing projection of an open suggestion: an optional follow-up
 * question. `devices` are the names of the devices it would act on.
 * Answer it with `answer_suggestion`; the VM-side `data` never leaks.
 */
export type SuggestionPrompt = {
  id: string
  devices: string[]
} & (
  | { type: 'text_input'; prompt: string; placeholder?: string }
  | { type: 'number_input'; prompt: string; min?: number; max?: number }
  | { type: 'choice'; prompt: string; choices: InteractionChoice[] }
)

export type BlockedCode = 'interaction_pending' | 'no_pending_interaction'

export interface ToolError {
  code: string
  message: string
  hint?: string
}

/** A `RunResult` without its interaction payload — the flat completed body. */
export type RunResultSummary = Omit<RunResult, 'interaction'>

/**
 * A device whose driver rejected a command (action or property write). The
 * VM records these as failed outcomes rather than errors, so a run can be
 * `completed` while a device did not do what was asked.
 */
export interface DeviceFailure {
  deviceId: string
  message: string
}

export type ToolResult =
  | {
      status: 'completed'
      result?: RunResultSummary
      session?: SessionSummary
      deviceFailures?: DeviceFailure[]
      suggestions?: SuggestionPrompt[]
    }
  | { status: 'waiting_for_user'; interaction: InteractionPrompt }
  | {
      status: 'blocked'
      error: { code: BlockedCode; message: string; interactionType?: string }
    }
  | { status: 'failed'; error: ToolError }

export function toMissingParameterSummary(
  param: MissingParameter,
): MissingParameterSummary {
  return {
    name: param.name,
    type: param.type,
    ...(param.values !== undefined ? { values: param.values } : {}),
  }
}

/**
 * Project a VM `UserInteraction` into an agent-facing prompt. The core's
 * message is passed through verbatim. Returns `null` for interaction types
 * outside the six core variants (safety net for host-registered handlers).
 */
export function toInteractionPrompt(
  interaction: UserInteraction,
): InteractionPrompt | null {
  switch (interaction.type) {
    case 'device_selection':
      return {
        type: 'device_selection',
        prompt: interaction.message,
        choices: interaction.devices.map(device => ({
          id: device.id,
          label: device.name,
        })),
      }
    case 'confirmation':
      return { type: 'confirmation', prompt: interaction.message }
    case 'text_input':
      return {
        type: 'text_input',
        prompt: interaction.message,
        ...(interaction.placeholder !== undefined
          ? { placeholder: interaction.placeholder }
          : {}),
      }
    case 'number_input':
      return {
        type: 'number_input',
        prompt: interaction.message,
        ...(interaction.min !== undefined ? { min: interaction.min } : {}),
        ...(interaction.max !== undefined ? { max: interaction.max } : {}),
      }
    case 'choice':
      return {
        type: 'choice',
        prompt: interaction.message,
        choices: interaction.options.map(option => ({
          id: option.value,
          label: option.label,
        })),
      }
    case 'action_parameter':
      return {
        type: 'action_parameter',
        prompt: interaction.message,
        missing: interaction.missing.map(toMissingParameterSummary),
      }
    default:
      return null
  }
}

export function toSuggestionPrompt(
  suggestion: SuggestionSummary,
): SuggestionPrompt {
  const { id, question } = suggestion
  const devices = suggestion.targets.map(target => target.name)
  switch (question.type) {
    case 'text_input':
      return {
        id,
        devices,
        type: 'text_input',
        prompt: question.message,
        ...(question.placeholder !== undefined
          ? { placeholder: question.placeholder }
          : {}),
      }
    case 'number_input':
      return {
        id,
        devices,
        type: 'number_input',
        prompt: question.message,
        ...(question.min !== undefined ? { min: question.min } : {}),
        ...(question.max !== undefined ? { max: question.max } : {}),
      }
    case 'choice':
      return {
        id,
        devices,
        type: 'choice',
        prompt: question.message,
        choices: question.options.map(option => ({
          id: option.value,
          label: option.label,
        })),
      }
  }
}

function failed(code: string, message: string): ToolResult {
  return { status: 'failed', error: { code, message } }
}

/**
 * Project a `RunResult` into the flat agent envelope: `waiting_for_user`
 * when the run suspended, `failed` for error runs, `completed` otherwise.
 * The `session` field of the completed variant is left to callers that hold
 * session state (`get_session`); this projection only sees the run.
 */
export function toToolResult(
  result: RunResult,
  options?: { executedFrom?: number },
): ToolResult {
  if (result.interaction !== null) {
    const prompt = toInteractionPrompt(result.interaction)
    if (prompt === null) {
      return failed(
        'unsupported_interaction_type',
        `Unsupported interaction type: ${result.interaction.type}`,
      )
    }
    return { status: 'waiting_for_user', interaction: prompt }
  }

  if (result.status === 'error' || result.errors.length > 0) {
    const message = result.errors.map(error => error.message).join('; ')
    return failed(
      'execution_failed',
      message === '' ? 'Execution failed' : message,
    )
  }

  // `executed` is the whole session history; keep only this program's tail.
  const executed = result.executed.slice(options?.executedFrom ?? 0)
  const deviceFailures = collectDeviceFailures(executed)
  return {
    status: 'completed',
    result: { status: result.status, executed, errors: result.errors },
    ...(deviceFailures.length > 0 ? { deviceFailures } : {}),
    ...(result.suggestions !== undefined && result.suggestions.length > 0
      ? { suggestions: result.suggestions.map(toSuggestionPrompt) }
      : {}),
  }
}

function collectDeviceFailures(
  executed: RunResult['executed'],
): DeviceFailure[] {
  const failures: DeviceFailure[] = []
  for (const entry of executed) {
    for (const outcome of entry.outcomes ?? []) {
      if (outcome.execution.status === 'failed') {
        failures.push({
          deviceId: outcome.deviceId,
          message: outcome.execution.error ?? 'Device command failed',
        })
      }
    }
  }
  return failures
}
