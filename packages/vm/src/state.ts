import type { VMContext, VMResult, Session } from './types.js'
import type { UserResponse } from './interactions/types.js'
import { InteractionError } from './interactions/errors.js'
import { processInteractionResponse } from './interactions/registry.js'
import { interpretProgram } from './interpreter.js'

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

export async function resumeAndContinue(
  response: UserResponse,
  context: VMContext,
): Promise<VMResult> {
  const session = context.session
  if (!session) {
    throw new InteractionError(
      'no_session',
      'Cannot resume: no session in context',
    )
  }

  const program = session._pendingProgram
  if (!program) {
    throw new InteractionError(
      'no_pending_program',
      'Cannot resume: no pending program',
    )
  }

  resumeWithResponse(session, response, context.eventBus)

  return interpretProgram(
    program,
    context.devices,
    session,
    context.middleware,
    context.eventBus,
  )
}
