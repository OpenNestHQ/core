import type { VMContext, VMResult, Session } from "./types.js";
import type { UserResponse } from "./interactions/types.js";
import type { ExecutionTracer } from "./trace/types.js";
import { processInteractionResponse } from "./interactions/registry.js";
import { interpretProgram } from "./interpreter.js";

export function createSession(): Session {
  return {
    variables: {},
    it: null,
    history: [],
    cursor: 0,
    resolvedIds: {},
    variableResolvedIds: {},
    variableModifiers: {},
    pendingInteraction: null,
  };
}

export function resumeWithResponse(
  session: Session,
  response: UserResponse,
  tracer?: ExecutionTracer,
): Session {
  const pending = session.pendingInteraction;
  if (!pending) {
    throw new Error("No pending interaction to resume");
  }
  if (pending.id !== response.interactionId) {
    throw new Error(
      `Interaction ID mismatch: expected ${pending.id}, got ${response.interactionId}`,
    );
  }

  processInteractionResponse(pending.type, session, pending.context, response, tracer);
  session.pendingInteraction = null;
  return session;
}

export async function resumeAndContinue(
  response: UserResponse,
  context: VMContext,
): Promise<VMResult> {
  const session = context.session;
  if (!session) {
    throw new Error("Cannot resume: no session in context");
  }

  const program = session._pendingProgram;
  if (!program) {
    throw new Error("Cannot resume: no pending program");
  }

  resumeWithResponse(session, response, context.tracer);

  return interpretProgram(
    program,
    context.devices,
    session,
    context.policies,
    context.tracer,
  );
}
