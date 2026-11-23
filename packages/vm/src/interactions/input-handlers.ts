import type { Session } from '../types.js'
import type {
  InteractionHandler,
  UserInteraction,
  UserResponse,
} from './types.js'
import type { AskQuestion } from './ask.js'
import { isAskContext } from './ask.js'
import { checkInputAnswer } from './input-answer.js'
import type { InputAnswerResponse } from './input-answer.js'
import { InteractionError } from './errors.js'

type InputType = AskQuestion['type']

function createInputHandler(type: InputType): InteractionHandler {
  return {
    type,

    createInteraction(): UserInteraction {
      throw new Error(
        `"${type}" interactions are created by ask(), not via createInteraction()`,
      )
    },

    processResponse(
      _session: Session,
      context: unknown,
      response: UserResponse,
    ): void {
      if (response.type !== type) {
        throw new InteractionError(
          'interaction_type_mismatch',
          `Expected a response of type "${type}", got "${response.type}"`,
        )
      }
      if (!isAskContext(context)) {
        throw new Error(
          `"${type}" interactions must be raised via ask() (createAsk()); hand-rolled PauseSignal contexts are not supported`,
        )
      }
      // response.type === type, checked above
      const check = checkInputAnswer(
        context.question,
        response as InputAnswerResponse,
      )
      if (!check.ok) {
        throw new InteractionError('invalid_response', check.message)
      }
      context.store.set(context.programId, context.answerKey, check.value)
    },
  }
}

export const textInputHandler = createInputHandler('text_input')
export const numberInputHandler = createInputHandler('number_input')
export const choiceHandler = createInputHandler('choice')
