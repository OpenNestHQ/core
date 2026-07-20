import { registerHandler } from "./interactions/registry.js";
import { deviceSelectionHandler } from "./interactions/device-selection.js";
import { confirmationHandler } from "./interactions/confirmation.js";

registerHandler(deviceSelectionHandler);
registerHandler(confirmationHandler);

export { executeCommand } from "./commands/dispatch.js";
export type {
  VMCommand,
  RunProgramCommand,
  ExecuteActionCommand,
  ExecuteStatementCommand,
  ResumeInteractionCommand,
  CancelExecutionCommand,
} from "./commands/types.js";

export { validateProgram } from "./validate.js";
export { createSession } from "./state.js";

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
} from "./types.js";

export type {
  UserInteraction,
  UserResponse,
  DeviceSelectionInteraction,
  DeviceSelectionDevice,
  ConfirmationInteraction,
  TextInputInteraction,
  NumberInputInteraction,
  ChoiceInteraction,
  DeviceSelectionResponse,
  ConfirmationResponse,
  TextInputResponse,
  NumberInputResponse,
  ChoiceResponse,
} from "./interactions/types.js";

export { NoopExecutionPolicy } from "./policies/noop.js";
export { ConfirmationPolicy } from "./policies/confirmation.js";
export type {
  ExecutionPolicy,
  PolicyContext,
  PolicyDecision,
  ContinueDecision,
  BlockDecision,
  SkipDecision,
  PauseDecision,
  ReplaceDecision,
  ExpandDecision,
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
} from "./policies/types.js";

export { NodeStatus, NodeKind } from "./trace/index.js";
export { DefaultExecutionTracer } from "./trace/index.js";
export { DefaultVMEventBus } from "./trace/index.js";
export type {
  ExecutionNode,
  ExecutionTrace,
  ExecutionTracer,
  VMEvent,
  ProgramBeginEvent,
  ProgramEndEvent,
  StatementBeginEvent,
  StatementEndEvent,
  VMEventBus,
} from "./trace/index.js";
