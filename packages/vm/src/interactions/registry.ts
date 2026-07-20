import type { Session } from "../types.js";
import type { VMEventBus } from "../trace/event-bus.js";
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
  eventBus?: VMEventBus,
): UserInteraction {
  const handler = handlers.get(type);
  if (!handler) {
    throw new Error(`Unknown interaction type: ${type}`);
  }

  eventBus?.emit({
    kind: "handler:begin",
    timestamp: Date.now(),
    name: type,
  });

  const interaction = handler.createInteraction(context);

  eventBus?.emit({
    kind: "handler:end",
    timestamp: Date.now(),
    status: "waiting",
  });

  return interaction;
}

export function processInteractionResponse(
  type: string,
  session: Session,
  context: unknown,
  response: UserResponse,
  eventBus?: VMEventBus,
): void {
  const handler = handlers.get(type);
  if (!handler) {
    throw new Error(`Unknown interaction type: ${type}`);
  }

  eventBus?.emit({
    kind: "handler:begin",
    timestamp: Date.now(),
    name: type,
  });

  handler.processResponse(session, context, response);

  eventBus?.emit({
    kind: "handler:end",
    timestamp: Date.now(),
    status: "success",
  });
}
