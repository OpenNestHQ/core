import type { Session } from "../types.js";
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
): UserInteraction {
  const handler = handlers.get(type);
  if (!handler) {
    throw new Error(`Unknown interaction type: ${type}`);
  }
  return handler.createInteraction(context);
}

export function processInteractionResponse(
  type: string,
  session: Session,
  context: unknown,
  response: UserResponse,
): void {
  const handler = handlers.get(type);
  if (!handler) {
    throw new Error(`Unknown interaction type: ${type}`);
  }
  handler.processResponse(session, context, response);
}
