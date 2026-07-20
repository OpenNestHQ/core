import type { Session } from "../types.js";
import type { ExecutionTracer } from "../trace/types.js";
import { NodeKind } from "../trace/types.js";
import type {
  InteractionHandler,
  UserInteraction,
  UserResponse,
} from "./types.js";

const handlers = new Map<string, InteractionHandler>();

export function registerHandler(handler: InteractionHandler): void {
  handlers.set(handler.type, handler);
}

export function createInteraction(
  type: string,
  context: unknown,
  tracer?: ExecutionTracer,
): UserInteraction {
  const handler = handlers.get(type);
  if (!handler) {
    throw new Error(`Unknown interaction type: ${type}`);
  }

  tracer?.beginNode(NodeKind.Handler, `handler:${type}.create`);
  tracer?.attribute("interactionType", type);

  const interaction = handler.createInteraction(context);

  tracer?.attribute("interactionId", interaction.id);
  tracer?.endSuccess();

  return interaction;
}

export function processInteractionResponse(
  type: string,
  session: Session,
  context: unknown,
  response: UserResponse,
  tracer?: ExecutionTracer,
): void {
  const handler = handlers.get(type);
  if (!handler) {
    throw new Error(`Unknown interaction type: ${type}`);
  }

  tracer?.beginNode(NodeKind.Handler, `handler:${type}.processResponse`);
  tracer?.attribute("interactionType", type);
  tracer?.attribute("interactionId", response.interactionId);

  handler.processResponse(session, context, response);

  tracer?.endSuccess();
}
