import type { Session } from '../types.js'
import type {
  InteractionHandler,
  ConfirmationInteraction,
  UserResponse,
} from './types.js'
import type { ConfirmationResumeContext } from '../middleware/confirmation.js'
import { InteractionError } from './errors.js'

export type { ConfirmationResumeContext }

export const confirmationHandler: InteractionHandler<ConfirmationResumeContext> =
  {
    type: 'confirmation',

    createInteraction(): ConfirmationInteraction {
      throw new Error(
        'Confirmation interactions are created by middleware, not via createInteraction()',
      )
    },

    processResponse(
      _session: Session,
      context: ConfirmationResumeContext,
      response: UserResponse,
    ): void {
      if (response.type !== 'confirmation') {
        throw new InteractionError(
          'interaction_type_mismatch',
          `Expected a response of type "confirmation", got "${response.type}"`,
        )
      }
      context.decisions.set(context.fingerprint, response.confirmed)
    },
  }
