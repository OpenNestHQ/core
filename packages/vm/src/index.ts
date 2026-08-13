import { registerHandler } from './interactions/registry.js'
import { deviceSelectionHandler } from './interactions/device-selection.js'
import { confirmationHandler } from './interactions/confirmation.js'
import { actionParameterHandler } from './interactions/action-parameter.js'

registerHandler(deviceSelectionHandler)
registerHandler(confirmationHandler)
registerHandler(actionParameterHandler)

export { executeCommand } from './commands/dispatch.js'
export type {
  VMCommand,
  RunProgramCommand,
  ExecuteActionCommand,
  ExecuteStatementCommand,
  ResumeInteractionCommand,
  CancelExecutionCommand,
} from './commands/types.js'

export { validateProgram } from './validate.js'
export { createSession } from './state.js'

export type {
  Device,
  StateChange,
  ExecutedStatement,
  Session,
  VMError,
  VMStatus,
  VMResult,
  VMContext,
  ResolutionIntent,
  ResolutionFilter,
  ExcludedDevice,
  ResolutionResult,
} from './types.js'

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
} from './interactions/types.js'

export { noopMiddleware } from './middleware/noop.js'
export { createConfirmationMiddleware } from './middleware/confirmation.js'
export type { ConfirmationMiddlewareConfig } from './middleware/confirmation.js'
export {
  BlockSignal,
  SkipSignal,
  PauseSignal,
  ExpandSignal,
} from './middleware/types.js'
export type {
  Middleware,
  MiddlewareContext,
  PlannedAction,
  SetPropertyAction,
  IncrementPropertyAction,
  ReadPropertyAction,
  InvokeActionAction,
  PipelineOutcome,
  ExecuteOutcome,
  BlockedOutcome,
  SkippedOutcome,
  PausedOutcome,
} from './middleware/types.js'

export { NodeStatus, NodeKind } from './trace/index.js'
export { DefaultExecutionTracer } from './trace/index.js'
export { DefaultVMEventBus } from './trace/index.js'
export type {
  ExecutionNode,
  ExecutionTrace,
  ExecutionTracer,
  VMEvent,
  ProgramBeginEvent,
  ProgramEndEvent,
  StatementBeginEvent,
  StatementEndEvent,
  MiddlewareBeginEvent,
  MiddlewareEndEvent,
  VMEventBus,
} from './trace/index.js'
