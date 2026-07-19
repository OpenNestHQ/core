import type { Program } from "@opennest/lang-core";
import type { VMResult, VMContext } from "./types.js";
import { executeCommand } from "./commands/dispatch.js";
import { registerHandler } from "./interactions/registry.js";
import { deviceSelectionHandler } from "./interactions/device-selection.js";
import { confirmationHandler } from "./interactions/confirmation.js";

// Register built-in interaction handlers
registerHandler(deviceSelectionHandler);
registerHandler(confirmationHandler);

export async function interpret_home_dsl(
  program: Program,
  context: VMContext,
): Promise<VMResult> {
  return executeCommand({ kind: "run_program", program }, context);
}

export { executeCommand } from "./commands/dispatch.js";
export type {
  VMCommand,
  RunProgramCommand,
  ExecuteActionCommand,
  ExecuteStatementCommand,
  ResumeInteractionCommand,
  CancelExecutionCommand,
} from "./commands/types.js";

export { interpretProgram } from "./interpreter.js";
export { createSession, resumeWithResponse, resumeAndContinue } from "./state.js";
export { resolveDevices, resolveDeviceById } from "./resolver.js";
export { expandCollection, selectFirst, selectAll } from "./collections.js";
export {
  registerHandler,
  createInteraction,
  processInteractionResponse,
} from "./interactions/registry.js";
export {
  executeAssignment,
  executeIncrement,
  executeQuery,
  executeAction,
  executePlannedAction,
  evaluateCondition,
} from "./executor.js";
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
  ResolvedStatement,
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
  InteractionHandler,
  PendingInteraction,
} from "./interactions/types.js";
export type { DeviceSelectionContext } from "./interactions/device-selection.js";
export { confirmationHandler } from "./interactions/confirmation.js";
export type { ConfirmationContext } from "./interactions/confirmation.js";
export { NoopExecutionPolicy } from "./policies/noop.js";
export { ConfirmationPolicy } from "./policies/confirmation.js";
export { runPolicyPipeline } from "./policies/pipeline.js";
export type { PipelineEnvironment } from "./policies/pipeline.js";
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
