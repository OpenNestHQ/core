import type {
  Statement,
  DeviceRef,
} from "@opennest/lang-core";
import type { DeviceDriver } from "@opennest/devices";

export interface Device {
  id: string;
  type: string;
  room: string;
  name: string;
  driver: DeviceDriver;
  driverConfig: Record<string, unknown>;
}

export interface StateChange {
  deviceId: string;
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ExecutedStatement {
  statement: Statement;
  resolvedDevices: Device[];
  changes: StateChange[];
  filter?: ResolutionFilter;
}

export interface Session {
  variables: Record<string, DeviceRef>;
  it: Device | null;
  history: ExecutedStatement[];
  cursor: number;
  resolvedIds: Record<string, string>;
  variableResolvedIds: Record<string, string>;
  variableModifiers: Record<string, "@all" | "@first">;
}

export interface AmbiguityTreeDevice {
  key: string;
  id: string;
  dsl: string;
}

export interface AmbiguityTreeRoom {
  key: string;
  dsl: string;
  children: AmbiguityTreeDevice[];
}

export interface AmbiguityTreeNode {
  type: string;
  children: AmbiguityTreeRoom[];
}

export interface AmbiguityInfo {
  kind: "target";
  tree: AmbiguityTreeNode;
}

export interface VMError {
  statement: Statement;
  message: string;
}

export type VMStatus = "success" | "waiting" | "error";

export interface VMResult {
  status: VMStatus;
  session: Session;
  executed: ExecutedStatement[];
  awaiting: AmbiguityInfo | null;
  errors: VMError[];
}

export interface VMContext {
  devices: Device[];
  session?: Session;
}

export interface ResolutionIntent {
  kind: "property" | "action";
  name: string;
}

export interface ExcludedDevice {
  deviceId: string;
  deviceName: string;
  reason: "property_not_supported" | "action_not_supported";
  details: string;
}

export interface ResolutionFilter {
  candidates: number;
  matched: number;
  excluded: ExcludedDevice[];
}

export interface ResolutionResult {
  devices: Device[];
  ambiguous: boolean;
  filter?: ResolutionFilter;
}

export interface ResolvedStatement {
  kind: "assignment" | "query" | "increment" | "action" | "variable_assignment";
  devices: Device[];
  propertyOrMethod: string;
  value?: unknown;
  variableName?: string;
  variableRef?: DeviceRef;
}
