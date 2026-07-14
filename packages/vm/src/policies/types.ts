import type { Value } from "@opennest/lang-core";
import type { Device, Session } from "../types.js";
import type { UserInteraction } from "../interactions/types.js";

export type PlannedAction =
  | SetPropertyAction
  | IncrementPropertyAction
  | ReadPropertyAction
  | InvokeActionAction;

export interface SetPropertyAction {
  kind: "set_property";
  device: Device;
  property: string;
  value: Value;
}

export interface IncrementPropertyAction {
  kind: "increment_property";
  device: Device;
  property: string;
  value: Value;
}

export interface ReadPropertyAction {
  kind: "read_property";
  device: Device;
  property: string;
}

export interface InvokeActionAction {
  kind: "invoke_action";
  device: Device;
  method: string;
}

export type PolicyDecision =
  | ContinueDecision
  | BlockDecision
  | SkipDecision
  | PauseDecision
  | ReplaceDecision
  | ExpandDecision;

export interface ContinueDecision {
  kind: "continue";
}

export interface BlockDecision {
  kind: "block";
  reason: string;
}

export interface SkipDecision {
  kind: "skip";
  reason?: string;
}

export interface PauseDecision {
  kind: "pause";
  interaction: UserInteraction;
  context?: unknown;
}

export interface ReplaceDecision {
  kind: "replace";
  action: PlannedAction;
}

export interface ExpandDecision {
  kind: "expand";
  actions: PlannedAction[];
}

export interface PolicyContext {
  action: PlannedAction;
  session: Session;
  devices: Device[];
}

export interface ExecutionPolicy {
  readonly name: string;
  evaluate(ctx: PolicyContext): PolicyDecision | Promise<PolicyDecision>;
}

export type PipelineOutcome =
  | ExecuteOutcome
  | BlockedOutcome
  | SkippedOutcome
  | PausedOutcome;

export interface ExecuteOutcome {
  kind: "execute";
  actions: PlannedAction[];
}

export interface BlockedOutcome {
  kind: "blocked";
  policyName: string;
  reason: string;
}

export interface SkippedOutcome {
  kind: "skipped";
  reason?: string;
}

export interface PausedOutcome {
  kind: "paused";
  interaction: UserInteraction;
  context?: unknown;
}
