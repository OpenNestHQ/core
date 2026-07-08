import type { Program } from "@opennest/lang-core";
import type { VMResult, VMContext } from "./types.js";
import { interpretProgram } from "./interpreter.js";

export async function interpret_home_dsl(
  program: Program,
  context: VMContext,
): Promise<VMResult> {
  return interpretProgram(program, context.devices, context.session);
}

export { interpretProgram } from "./interpreter.js";
export { createSession, applyResolution, resolveAmbiguity } from "./state.js";
export { resolveDevices, resolveDeviceById } from "./resolver.js";
export { expandCollection, selectFirst, selectAll } from "./collections.js";
export { buildAmbiguityInfo, buildAmbiguityTree } from "./ambiguity.js";
export {
  executeAssignment,
  executeIncrement,
  executeQuery,
  executeAction,
  evaluateCondition,
} from "./executor.js";
export type {
  Device,
  StateChange,
  ExecutedStatement,
  Session,
  AmbiguityTreeDevice,
  AmbiguityTreeRoom,
  AmbiguityTreeNode,
  AmbiguityInfo,
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
