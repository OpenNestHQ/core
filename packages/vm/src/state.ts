import type { Session } from "./types.js";
import type { UserResponse } from "./interactions/types.js";
import { processInteractionResponse } from "./interactions/registry.js";

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

  processInteractionResponse(pending.type, session, pending.context, response);
  session.pendingInteraction = null;
  return session;
}
