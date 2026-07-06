import type {
  Statement,
  Assignment,
  Query,
  Increment,
  Action,
  VariableAssignment,
  DeviceRef,
} from "@opennest/lang-core";

export interface Device {
  id: string;
  type: string;
  room: string;
  name: string;
  state: Record<string, unknown>;
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

export interface ResolutionResult {
  devices: Device[];
  ambiguous: boolean;
  choices: AmbiguityChoice[];
}

export interface ResolvedStatement {
  kind: "assignment" | "query" | "increment" | "action" | "variable_assignment";
  devices: Device[];
  propertyOrMethod: string;
  value?: unknown;
  variableName?: string;
  variableRef?: DeviceRef;
}
