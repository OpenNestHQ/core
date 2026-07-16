import type { Session } from "../types.js";
import type {
  InteractionHandler,
  ConfirmationInteraction,
  UserResponse,
} from "./types.js";
import type { ConfirmationPolicy } from "../policies/confirmation.js";

export interface ConfirmationContext {
  fingerprint: string;
  policy: ConfirmationPolicy;
}

export const confirmationHandler: InteractionHandler<ConfirmationContext> = {
  type: "confirmation",

  createInteraction(_context: ConfirmationContext): ConfirmationInteraction {
    throw new Error(
      "Confirmation interactions are created by policies, not via createInteraction()",
    );
  },

  processResponse(
    _session: Session,
    context: ConfirmationContext,
    response: UserResponse,
  ): void {
    if (response.type !== "confirmation") return;
    context.policy.resolve(context.fingerprint, response.confirmed);
  },
};
