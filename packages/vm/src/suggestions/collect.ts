import type { ActionOutcome } from '@opennest/lang-core'
import type { Session } from '../types.js'
import type { OpenSuggestion } from './types.js'

/**
 * After a statement's batch ran: a target counts only when its action was
 * accepted by the driver. Offers not accepted are dropped.
 */
export function confirmCandidates(
  session: Session,
  cursor: number,
  outcomes: ActionOutcome[],
): void {
  const candidates = session._suggestionCandidates
  if (!candidates) return
  const accepted = new Set(
    outcomes
      .filter(o => o.execution.status === 'accepted')
      .map(o => o.deviceId),
  )
  for (const candidate of candidates) {
    if (
      candidate.programId !== session.programId ||
      candidate.cursor !== cursor
    )
      continue
    for (const id of candidate.pending) {
      if (accepted.has(id) && !candidate.confirmed.includes(id)) {
        candidate.confirmed.push(id)
      }
    }
    candidate.pending = []
  }
}

/**
 * Turns candidates with at least one accepted target into open suggestions,
 * appends them to `session.suggestions` and returns the newly opened ones.
 */
export function openConfirmedSuggestions(session: Session): OpenSuggestion[] {
  const opened: OpenSuggestion[] = []
  for (const candidate of session._suggestionCandidates ?? []) {
    if (candidate.confirmed.length === 0) continue
    opened.push({
      id: `suggestion_${crypto.randomUUID()}`,
      name: candidate.name,
      question: candidate.question,
      targets: [...candidate.confirmed],
      ...(candidate.data !== undefined ? { data: candidate.data } : {}),
    })
  }
  if (opened.length > 0) {
    session.suggestions = [...(session.suggestions ?? []), ...opened]
  }
  return opened
}

/** Drops the candidates collected during a run. */
export function clearSuggestionRun(session: Session): void {
  delete session._suggestionCandidates
}
