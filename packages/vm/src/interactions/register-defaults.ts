import { registerHandler } from './registry.js'
import { deviceSelectionHandler } from './device-selection.js'
import { confirmationHandler } from './confirmation.js'
import { actionParameterHandler } from './action-parameter.js'

registerHandler(deviceSelectionHandler)
registerHandler(confirmationHandler)
registerHandler(actionParameterHandler)
