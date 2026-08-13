/** Selectors refine which devices a segment matches. */
export type Selector = RoomByName | RoomWildcard | OwnerByName | TagByName

export interface RoomByName {
  kind: 'room'
  name: string
}

export interface RoomWildcard {
  kind: 'wildcard'
}

export interface OwnerByName {
  kind: 'owner'
  name: string
}

export interface TagByName {
  kind: 'tag'
  name: string
}

/** Backward-compatible alias for room-only selectors. */
export type RoomSelector = RoomByName | RoomWildcard

/** A single segment in a dot-separated path. The last segment is the property/method. */
export interface Segment {
  identifier: string
  selectors: Selector[]
  isVariable?: boolean
}

export function getRoomSelector(selectors: Selector[]): RoomSelector | null {
  for (const s of selectors) {
    if (s.kind === 'room' || s.kind === 'wildcard') return s
  }
  return null
}

/** Values that can appear in property assignments. */
export type Value = NumberValue | PowerValue | StringValue | IdentifierValue

export interface NumberValue {
  kind: 'number'
  value: number
}

export interface PowerValue {
  kind: 'power'
  value: 'on' | 'off'
}

export interface StringValue {
  kind: 'string'
  value: string
}

export interface IdentifierValue {
  kind: 'identifier'
  value: string
}

/** Expressions on the right side of a variable assignment. */
export type Expr = DeviceRef | CollectionRef | Value

export interface DeviceRef {
  kind: 'device_ref'
  deviceType: string
  selectors: Selector[]
}

export type CollectionModifier = '@all' | '@first' | '@oneof'

export interface CollectionRef {
  kind: 'collection'
  modifier: CollectionModifier
  device: {
    deviceType: string
    selectors: Selector[]
  }
}

/** Comparison operators for conditions. */
export type ComparisonOp = '==' | '!='

/** A simple condition: path? == value */
export interface SimpleCondition {
  kind: 'condition'
  path: Segment[]
  op: ComparisonOp
  value: Value
}

/** Compound operators for combining conditions. */
export type CompoundOp = '&' | '|'

/** A compound condition combining two sub-conditions with & or |. */
export interface CompoundCondition {
  kind: 'compound_condition'
  left: ConditionExpr
  operator: CompoundOp
  right: ConditionExpr
}

/** A condition expression — either a simple comparison or a compound. */
export type ConditionExpr = SimpleCondition | CompoundCondition

/** An @if / @else / @endif conditional block. */
export interface IfStatement {
  kind: 'if'
  condition: ConditionExpr
  body: Statement[]
  elseBody?: Statement[]
}

/** A reference to a whole named-argument bundle (`?arg1`). */
export interface ArgBundleRef {
  kind: 'arg_bundle_ref'
  name: string
}

/** A single HomeDSL statement. */
export type Statement =
  | Assignment
  | Query
  | Increment
  | Action
  | VariableAssignment
  | ArgFieldAssignment
  | ArgBundleAssignment
  | IfStatement

export interface Assignment {
  kind: 'assignment'
  path: Segment[]
  value: Value
}

export interface Query {
  kind: 'query'
  path: Segment[]
}

export interface Increment {
  kind: 'increment'
  path: Segment[]
  value: Value
}

export interface Action {
  kind: 'action'
  path: Segment[]
  args?: Record<string, Value>
  argBundle?: ArgBundleRef
}

export interface VariableAssignment {
  kind: 'variable_assignment'
  name: string
  value: Expr
}

export interface ArgFieldAssignment {
  kind: 'arg_field_assignment'
  name: string
  field: string
  value: Value
}

export interface ArgBundleAssignment {
  kind: 'arg_bundle_assignment'
  name: string
  values: Record<string, Value>
}

/** A complete HomeDSL program — a sequence of statements. */
export interface Program {
  kind: 'program'
  statements: Statement[]
}
