import type { Device, DeviceSummary, Session, StateChange } from '@opennest/sdk'
import type { MissingParameter } from '@opennest/vm'
import { toMissingParameterSummary } from './result.js'
import type {
  InteractionChoice,
  InteractionPrompt,
  MissingParameterSummary,
} from './result.js'

/** One condensed history entry: devices touched and state changes applied. */
export interface SessionHistoryEntry {
  devices: DeviceSummary[]
  changes: StateChange[]
}

/**
 * Sanitized, JSON-safe projection of a VM session for agents. Only the
 * listed fields are copied — internal state (`cursor`, the raw resolved-id
 * maps, `_pendingProgram`, live drivers) never leaks.
 */
export interface SessionSummary {
  programId: string
  /** Variable name → resolved device id ('unresolved' when not resolved yet). */
  variables: Record<string, string>
  it: DeviceSummary | null
  historyCount: number
  /** At most the last `HISTORY_TAIL_LENGTH` history entries. */
  historyTail: SessionHistoryEntry[]
  pendingInteraction: InteractionPrompt | null
}

const HISTORY_TAIL_LENGTH = 5

export function toSessionSummary(session: Session): SessionSummary {
  return {
    programId: session.programId,
    variables: projectVariables(session),
    it: session.it === null ? null : toDeviceSummary(session.it),
    historyCount: session.history.length,
    historyTail: session.history.slice(-HISTORY_TAIL_LENGTH).map(entry => ({
      devices: entry.resolvedDevices.map(toDeviceSummary),
      changes: entry.changes,
    })),
    pendingInteraction:
      session.pendingInteraction === null
        ? null
        : toPendingInteractionPrompt(session.pendingInteraction),
  }
}

/**
 * Variable name → resolved device id. `variableResolvedIds` is the durable
 * per-variable map (the one the resolver consults); `resolvedIds` — keyed by
 * device type and cleared after each statement — is consulted as a fallback
 * so an in-flight selection still shows up.
 */
function projectVariables(session: Session): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const name of Object.keys(session.variables)) {
    variables[name] =
      session.variableResolvedIds[name] ??
      session.resolvedIds[name] ??
      'unresolved'
  }
  return variables
}

/** Mirrors the SDK's private device summarization (drivers never leak). */
function toDeviceSummary(device: Device): DeviceSummary {
  return {
    id: device.id,
    type: device.type,
    room: device.room,
    name: device.name,
    ...(device.owners !== undefined ? { owners: device.owners } : {}),
    ...(device.tags !== undefined ? { tags: device.tags } : {}),
  }
}

type PendingInteraction = NonNullable<Session['pendingInteraction']>

/**
 * Best-effort projection of the pending interaction recorded in the session.
 * `PendingInteraction` carries the handler resume context, not the original
 * message (confirmation contexts hold no message at all), so prompts here are
 * generic English summaries — the verbatim prompt was already delivered by
 * the `waiting_for_user` result of the run that suspended. Data payloads
 * (choices, missing parameters) are extracted from the context where the
 * core handlers provide them. Custom interaction types outside the six core
 * variants cannot be represented and project to `null`.
 */
function toPendingInteractionPrompt(
  pending: PendingInteraction,
): InteractionPrompt | null {
  switch (pending.type) {
    case 'device_selection':
      return {
        type: 'device_selection',
        prompt:
          'A device selection is pending. Answer it with the respond tool.',
        choices: readPendingChoices(pending.context),
      }
    case 'confirmation':
      return {
        type: 'confirmation',
        prompt: 'A confirmation is pending. Answer it with the respond tool.',
      }
    case 'text_input':
      return {
        type: 'text_input',
        prompt: 'A text input is pending. Answer it with the respond tool.',
      }
    case 'number_input':
      return {
        type: 'number_input',
        prompt: 'A number input is pending. Answer it with the respond tool.',
      }
    case 'choice':
      // No core handler exists for `choice`; its context shape is
      // host-defined, so no choices can be extracted.
      return {
        type: 'choice',
        prompt: 'A choice is pending. Answer it with the respond tool.',
        choices: [],
      }
    case 'action_parameter':
      return {
        type: 'action_parameter',
        prompt:
          'Missing action parameters are pending. Answer with the respond tool.',
        missing: readPendingMissing(pending.context),
      }
    default:
      return null
  }
}

/** Extract device_selection choices from a `DeviceSelectionContext`. */
function readPendingChoices(context: unknown): InteractionChoice[] {
  if (typeof context !== 'object' || context === null) return []
  const devices = (context as { devices?: unknown }).devices
  if (!Array.isArray(devices)) return []
  return devices
    .filter(
      (device): device is { id: string; name: string } =>
        typeof device === 'object' &&
        device !== null &&
        typeof (device as { id?: unknown }).id === 'string' &&
        typeof (device as { name?: unknown }).name === 'string',
    )
    .map(device => ({ id: device.id, label: device.name }))
}

/** Extract missing parameters from an `ActionParameterContext`. */
function readPendingMissing(context: unknown): MissingParameterSummary[] {
  if (typeof context !== 'object' || context === null) return []
  const missing = (context as { missing?: unknown }).missing
  if (!Array.isArray(missing)) return []
  return missing
    .filter(
      (param): param is MissingParameter =>
        typeof param === 'object' &&
        param !== null &&
        typeof (param as { name?: unknown }).name === 'string' &&
        isParameterType((param as { type?: unknown }).type),
    )
    .map(toMissingParameterSummary)
}

function isParameterType(value: unknown): value is MissingParameter['type'] {
  return (
    value === 'string' ||
    value === 'number' ||
    value === 'power' ||
    value === 'enum'
  )
}
