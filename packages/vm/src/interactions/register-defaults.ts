import { registerHandler } from './registry.js'
import { deviceSelectionHandler } from './device-selection.js'
import { confirmationHandler } from './confirmation.js'
import { actionParameterHandler } from './action-parameter.js'
import {
  textInputHandler,
  numberInputHandler,
  choiceHandler,
} from './input-handlers.js'

registerHandler(deviceSelectionHandler)
registerHandler(confirmationHandler)
registerHandler(actionParameterHandler)
registerHandler(textInputHandler)
registerHandler(numberInputHandler)
registerHandler(choiceHandler)
