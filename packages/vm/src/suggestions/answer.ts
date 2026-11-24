import { Effect } from 'effect'
import type { Session, VMContext, VMError, VMResult } from '../types.js'
import type { AnswerSuggestionCommand } from '../commands/types.js'
import { MiddlewareError } from '../effect/errors.js'
import type { VMInfraError } from '../effect/errors.js'
import type { EffectVMResult, StopToken } from '../effect/stop.js'
import { checkInputAnswer } from '../interactions/input-answer.js'
import type { InputAnswerResponse } from '../interactions/input-answer.js'
import { createSession } from '../state.js'
import { clearSuggestionRun } from './collect.js'
import { lookupSuggestion } from './registry.js'
import { buildFollowUpSteps, runFollowUpEffect } from './follow-up.js'

/**
 * Answers an open suggestion. A rejected answer (pending interaction, unknown
 * id, wrong type, invalid value, unregistered name) is an error `VMResult`
 * with nothing executed and the suggestion kept. Otherwise the suggestion is
 * removed and its `apply` result runs as a new execution (fresh `programId`)
 * through middleware; `apply` throwing is a `MiddlewareError`.
 */
export function answerSuggestionEffect(
  command: AnswerSuggestionCommand,
  context: VMContext,
  stop: StopToken,
): Effect.Effect<EffectVMResult, VMInfraError> {
  return Effect.gen(function* () {
    const session = context.session ?? createSession()
    const reject = (code: string, message: string) =>
      rejected(session, { code, message })

    const pending = session.pendingInteraction
    if (pending !== null && pending !== undefined) {
      return reject(
        'interaction_pending',
        `Interaction ${pending.id} (${pending.type}) is pending. Answer it with resume_interaction, or cancel the execution first.`,
      )
    }

    const suggestion = session.suggestions?.find(
      s => s.id === command.suggestionId,
    )
    if (!suggestion) {
      return reject(
        'suggestion_not_found',
        `No open suggestion ${command.suggestionId}: it was answered, or dropped by a newer command`,
      )
    }

    const { question } = suggestion
    const { response } = command
    if (response.type !== question.type) {
      return reject(
        'interaction_type_mismatch',
        `Expected a response of type "${question.type}", got "${response.type}"`,
      )
    }

    const check = checkInputAnswer(question, {
      ...response,
      interactionId: suggestion.id,
    } as InputAnswerResponse)
    if (!check.ok) return reject('invalid_response', check.message)

    const definition = lookupSuggestion(suggestion.name)
    if (!definition) {
      return reject(
        'suggestion_unavailable',
        `Suggestion "${suggestion.name}" is not defined in this runtime`,
      )
    }

    // A new execution: its own programId, and the suggestion is used up.
    session.programId = crypto.randomUUID()
    const remaining = session.suggestions!.filter(s => s.id !== suggestion.id)
    if (remaining.length > 0) session.suggestions = remaining
    else delete session.suggestions
    clearSuggestionRun(session)

    const devices = suggestion.targets
      .map(id => context.devices.find(d => d.id === id))
      .filter(d => d !== undefined)
    const middlewareName = `suggestion:${suggestion.name}`

    const steps = yield* Effect.tryPromise({
      try: async () =>
        buildFollowUpSteps(
          await definition.apply(check.value, devices, suggestion.data),
          context.devices,
        ),
      catch: cause => new MiddlewareError({ middlewareName, cause }),
    })

    const followUp = { suggestionId: suggestion.id, steps }
    session._pendingFollowUp = followUp
    session.cursor = 0
    session.resolvedIds = {}
    return yield* runFollowUpEffect(context, session, followUp, stop)
  })
}

function rejected(session: Session, error: VMError): VMResult {
  return {
    status: 'error',
    session,
    executed: [],
    interaction: null,
    errors: [error],
  }
}
