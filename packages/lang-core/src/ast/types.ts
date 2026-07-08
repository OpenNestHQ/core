/** A room selector specifies which room a device is in. */
export type RoomSelector = RoomByName | RoomWildcard;

export interface RoomByName {
  kind: "room";
  name: string;
}

export interface RoomWildcard {
  kind: "wildcard";
}

/** A single segment in a dot-separated path. The last segment is the property/method. */
export interface Segment {
  identifier: string;
  roomSelector: RoomSelector | null;
  isVariable?: boolean;
}

/** Values that can appear in property assignments. */
export type Value = NumberValue | PowerValue | StringValue | IdentifierValue;

export interface NumberValue {
  kind: "number";
  value: number;
}

export interface PowerValue {
  kind: "power";
  value: "on" | "off";
}

export interface StringValue {
  kind: "string";
  value: string;
}

export interface IdentifierValue {
  kind: "identifier";
  value: string;
}

/** Expressions on the right side of a variable assignment. */
export type Expr = DeviceRef | CollectionRef | Value;

export interface DeviceRef {
  kind: "device_ref";
  deviceType: string;
  roomSelector: RoomSelector | null;
}

export type CollectionModifier = "@all" | "@first";

export interface CollectionRef {
  kind: "collection";
  modifier: CollectionModifier;
  device: {
    deviceType: string;
    roomSelector: RoomSelector | null;
  };
}

/** Comparison operators for conditions. */
export type ComparisonOp = "==" | "!=";

/** A condition expression inside an @if block. */
export interface Condition {
  kind: "condition";
  path: Segment[];
  op: ComparisonOp;
  value: Value;
}

/** An @if / @else / @endif conditional block. */
export interface IfStatement {
  kind: "if";
  condition: Condition;
  body: Statement[];
  elseBody?: Statement[];
}

/** A single HomeDSL statement. */
export type Statement =
  | Assignment
  | Query
  | Increment
  | Action
  | VariableAssignment
  | IfStatement;

export interface Assignment {
  kind: "assignment";
  path: Segment[];
  value: Value;
}

export interface Query {
  kind: "query";
  path: Segment[];
}

export interface Increment {
  kind: "increment";
  path: Segment[];
  value: Value;
}

export interface Action {
  kind: "action";
  path: Segment[];
}

export interface VariableAssignment {
  kind: "variable_assignment";
  name: string;
  value: Expr;
}

/** A complete HomeDSL program — a sequence of statements. */
export interface Program {
  kind: "program";
  statements: Statement[];
}
