export {
  registerHandler,
  createInteraction,
  processInteractionResponse,
} from './registry.js'

export { deviceSelectionHandler } from './device-selection.js'
export type { DeviceSelectionContext } from './device-selection.js'
export { confirmationHandler } from './confirmation.js'
export type { ConfirmationResumeContext } from './confirmation.js'
export { actionParameterHandler } from './action-parameter.js'
export type { ActionParameterContext } from './action-parameter.js'

export type {
  UserInteraction,
  UserResponse,
  DeviceSelectionInteraction,
  DeviceSelectionDevice,
  ConfirmationInteraction,
  TextInputInteraction,
  NumberInputInteraction,
  ChoiceInteraction,
  ActionParameterInteraction,
  MissingParameter,
  DeviceSelectionResponse,
  ConfirmationResponse,
  TextInputResponse,
  NumberInputResponse,
  ChoiceResponse,
  ActionParameterResponse,
  InteractionHandler,
  PendingInteraction,
} from './types.js'
