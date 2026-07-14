import type { Program } from "@opennest/lang-core";
import type { VMResult, VMContext } from "./types.js";
import { interpretProgram } from "./interpreter.js";
import { registerHandler } from "./interactions/registry.js";
import { deviceSelectionHandler } from "./interactions/device-selection.js";

// Register built-in interaction handlers
registerHandler(deviceSelectionHandler);

export async function interpret_home_dsl(
  program: Program,
  context: VMContext,
): Promise<VMResult> {
  return interpretProgram(program, context.devices, context.session, context.policies);
}

export { interpretProgram } from "./interpreter.js";
export { createSession, resumeWithResponse } from "./state.js";
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
export { NoopExecutionPolicy } from "./policies/noop.js";
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
