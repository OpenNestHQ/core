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
}

export interface AmbiguityChoice {
  dsl: string;
  label: string;
}

export interface AmbiguityInfo {
  kind: "target";
  choices: AmbiguityChoice[];
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
  choices: AmbiguityChoice[];
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
