import { Effect } from 'effect'
import type { VMContext, VMResult, Session } from './types.js'
import type { VMInfraError } from './effect/errors.js'
import { runPromiseRethrowingOriginal } from './effect/run.js'
import type { UserResponse } from './interactions/types.js'
import { InteractionError } from './interactions/errors.js'
import { processInteractionResponse } from './interactions/registry.js'
import { interpretProgramEffect } from './interpreter.js'
import { runFollowUpEffect } from './suggestions/follow-up.js'
import { neverStop, toVMResult } from './effect/stop.js'
import type { EffectVMResult, StopToken } from './effect/stop.js'

export function createSession(): Session {
  return {
    programId: crypto.randomUUID(),
    variables: {},
    argVariables: {},
    it: null,
    history: [],
    cursor: 0,
    resolvedIds: {},
    variableResolvedIds: {},
    variableModifiers: {},
    pendingInteraction: null,
  }
}

export function resumeWithResponse(
  session: Session,
  response: UserResponse,
  eventBus?: VMContext['eventBus'],
): Session {
  const pending = session.pendingInteraction
  if (!pending) {
    throw new InteractionError(
      'no_pending_interaction',
      'No pending interaction to resume',
    )
  }
  if (pending.id !== response.interactionId) {
    throw new InteractionError(
      'interaction_id_mismatch',
      `Interaction ID mismatch: expected ${pending.id}, got ${response.interactionId}`,
    )
  }

  processInteractionResponse(
    pending.type,
    session,
    pending.context,
    response,
    eventBus,
  )
  session.pendingInteraction = null
  return session
}

/**
 * Applies the user's response to the pending interaction, then continues the
 * suspended program. Resume preconditions failing (no session, no pending
 * program, mismatched interaction…) are an `InteractionError` in the error
 * channel.
 */
export function resumeAndContinueEffect(
  response: UserResponse,
  context: VMContext,
  stop: StopToken = neverStop,
): Effect.Effect<EffectVMResult, VMInfraError | InteractionError> {
  return Effect.gen(function* () {
    const session = context.session
    if (!session) {
      return yield* Effect.fail(
        new InteractionError(
          'no_session',
          'Cannot resume: no session in context',
        ),
      )
    }

    const followUp = session._pendingFollowUp
    if (followUp) {
      yield* catchInteractionError(() =>
        resumeWithResponse(session, response, context.eventBus),
      )
      return yield* runFollowUpEffect(context, session, followUp, stop)
    }

    const program = session._pendingProgram
    if (!program) {
      return yield* Effect.fail(
        new InteractionError(
          'no_pending_program',
          'Cannot resume: no pending program',
        ),
      )
    }

    yield* catchInteractionError(() =>
      resumeWithResponse(session, response, context.eventBus),
    )

    return yield* interpretProgramEffect(
      program,
      context.devices,
      session,
      context.middleware,
      context.eventBus,
      stop,
    )
  })
}

/** Promise façade of {@link resumeAndContinueEffect}; rejects with the original error. */
export function resumeAndContinue(
  response: UserResponse,
  context: VMContext,
): Promise<VMResult> {
  return runPromiseRethrowingOriginal(
    resumeAndContinueEffect(response, context).pipe(Effect.map(toVMResult)),
  )
}

/** Runs `thunk`, moving a thrown `InteractionError` to the error channel (anything else is a defect). */
function catchInteractionError<A>(
  thunk: () => A,
): Effect.Effect<A, InteractionError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(thunk())
    } catch (error) {
      if (error instanceof InteractionError) return Effect.fail(error)
      return Effect.die(error)
    }
  })
}
