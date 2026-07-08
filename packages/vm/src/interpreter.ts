import type {
  Program,
  Statement,
  Assignment,
  Query,
  Increment,
  Action,
  VariableAssignment,
  IfStatement,
  DeviceRef,
  ConditionExpr,
  SimpleCondition,
} from "@opennest/lang-core";
import type { Device, Session, VMResult, VMError } from "./types.js";
import type { AmbiguityInfo, ResolutionIntent } from "./types.js";
import { createSession } from "./state.js";
import { resolveDevices } from "./resolver.js";
import { buildAmbiguityInfo } from "./ambiguity.js";
import {
  executeAssignment,
  executeIncrement,
  executeQuery,
  executeAction,
  evaluateCondition,
} from "./executor.js";

export async function interpretProgram(
  program: Program,
  devices: Device[],
  existingSession?: Session,
): Promise<VMResult> {
  const session = existingSession ?? createSession();
  const errors: VMError[] = [];
  let awaiting = false;
  let ambiguityInfo: AmbiguityInfo | null = null;

  for (let i = session.cursor; i < program.statements.length; i++) {
    const statement = program.statements[i]!;
    const result = await interpretStatement(statement, devices, session);

    if (result.kind === "waiting") {
      awaiting = true;
      ambiguityInfo = result.ambiguity;
      session.cursor = i;
      break;
    }

    if (result.kind === "error") {
      errors.push(...result.errors);
    }

    session.resolvedIds = {};

    session.cursor = i + 1;
  }

  if (!awaiting) {
    session.cursor = 0;
  }

  if (awaiting) {
    return {
      status: "waiting",
      session,
      executed: session.history,
      awaiting: ambiguityInfo,
      errors,
    };
  }

  if (errors.length > 0) {
    return {
      status: "error",
      session,
      executed: session.history,
      awaiting: null,
      errors,
    };
  }

  return {
    status: "success",
    session,
    executed: session.history,
    awaiting: null,
    errors: [],
  };
}

type InterpretResult =
  | { kind: "success" }
  | { kind: "waiting"; ambiguity: AmbiguityInfo }
  | { kind: "error"; errors: VMError[] };

async function interpretStatement(
  statement: Statement,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  switch (statement.kind) {
    case "assignment":
      return interpretAssignment(statement, devices, session);
    case "query":
      return interpretQuery(statement, devices, session);
    case "increment":
      return interpretIncrement(statement, devices, session);
    case "action":
      return interpretAction(statement, devices, session);
    case "variable_assignment":
      return interpretVariableAssignment(statement, devices, session);
    case "if":
      return interpretIfStatement(statement, devices, session);
  }
}

async function interpretAssignment(
  stmt: Assignment,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.devices),
    };
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [
        {
          statement: stmt,
          message: `No devices found for path`,
        },
      ],
    };
  }

  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeAssignment(device, property, stmt.value),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
    ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
  });

  if (resolutionResult.devices[0]) {
    session.it = resolutionResult.devices[0];
  }

  return { kind: "success" };
}

async function interpretQuery(
  stmt: Query,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.devices),
    };
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [
        {
          statement: stmt,
          message: `No devices found for query`,
        },
      ],
    };
  }

  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeQuery(device, property),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
    ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
  });

  if (resolutionResult.devices[0]) {
    session.it = resolutionResult.devices[0];
  }

  return { kind: "success" };
}

async function interpretIncrement(
  stmt: Increment,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.devices),
    };
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [
        {
          statement: stmt,
          message: `No devices found for increment`,
        },
      ],
    };
  }

  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeIncrement(device, property, stmt.value),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
    ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
  });

  if (resolutionResult.devices[0]) {
    session.it = resolutionResult.devices[0];
  }

  return { kind: "success" };
}

async function interpretAction(
  stmt: Action,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  const method = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "action", name: method };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.devices),
    };
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [
        {
          statement: stmt,
          message: `No devices found for action`,
        },
      ],
    };
  }

  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeAction(device, method),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
    ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
  });

  if (resolutionResult.devices[0]) {
    session.it = resolutionResult.devices[0];
  }

  return { kind: "success" };
}

async function interpretVariableAssignment(
  stmt: VariableAssignment,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  if (stmt.value.kind === "device_ref") {
    session.variables[stmt.name] = stmt.value;
    delete session.variableResolvedIds[stmt.name];
    session.history.push({
      statement: stmt,
      resolvedDevices: [],
      changes: [],
    });
    return { kind: "success" };
  }

  if (stmt.value.kind === "collection") {
    const deviceRef: DeviceRef = {
      kind: "device_ref",
      deviceType: stmt.value.device.deviceType,
      roomSelector: stmt.value.device.roomSelector,
    };

    if (stmt.value.modifier === "@oneof") {
      const pseudoSegments = [
        {
          identifier: stmt.value.device.deviceType,
          roomSelector: stmt.value.device.roomSelector,
        },
      ];
      const resolutionResult = resolveDevices(pseudoSegments, devices, session);

      if (resolutionResult.ambiguous) {
        return {
          kind: "waiting",
          ambiguity: buildAmbiguityInfo(resolutionResult.devices),
        };
      }

      if (resolutionResult.devices.length === 0) {
        return {
          kind: "error",
          errors: [{
            statement: stmt,
            message: `No devices found for @oneof(${stmt.value.device.deviceType})`,
          }],
        };
      }

      const device = resolutionResult.devices[0]!;
      session.variables[stmt.name] = deviceRef;
      session.variableResolvedIds[stmt.name] = device.id;
      session.variableModifiers[stmt.name] = "@oneof";
      session.it = device;
      session.history.push({
        statement: stmt,
        resolvedDevices: [device],
        changes: [],
      });
      return { kind: "success" };
    }

    session.variables[stmt.name] = deviceRef;
    session.variableModifiers[stmt.name] = stmt.value.modifier;
    delete session.variableResolvedIds[stmt.name];
    session.history.push({
      statement: stmt,
      resolvedDevices: [],
      changes: [],
    });
    return { kind: "success" };
  }

  session.history.push({
    statement: stmt,
    resolvedDevices: [],
    changes: [],
  });
  return { kind: "success" };
}

function lastPropertyName(path: { identifier: string }[]): string {
  const lastSegment = path[path.length - 1];
  if (!lastSegment) return "";
  return lastSegment.identifier;
}

async function interpretIfStatement(
  stmt: IfStatement,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  const evalResult = await evaluateConditionExpr(stmt.condition, devices, session);

  if (evalResult.kind === "error") {
    return {
      kind: "error",
      errors: [{ statement: stmt, message: evalResult.message }],
    };
  }

  const conditionMet = evalResult.value;

  const statementsToExecute = conditionMet ? stmt.body : (stmt.elseBody ?? []);

  for (const bodyStmt of statementsToExecute) {
    const result = await interpretStatement(bodyStmt, devices, session);
    if (result.kind !== "success") {
      return result;
    }
  }

  session.history.push({
    statement: stmt,
    resolvedDevices: [],
    changes: [{
      deviceId: "",
      property: "condition",
      oldValue: null,
      newValue: conditionMet,
    }],
  });

  return { kind: "success" };
}

type ConditionEvalResult =
  | { kind: "ok"; value: boolean }
  | { kind: "error"; message: string };

async function evaluateConditionExpr(
  expr: ConditionExpr,
  devices: Device[],
  session: Session,
): Promise<ConditionEvalResult> {
  if (expr.kind === "condition") {
    return evaluateSimpleCondition(expr, devices, session);
  }

  if (expr.kind === "compound_condition") {
    const left = await evaluateConditionExpr(expr.left, devices, session);
    if (left.kind === "error") return left;

    if (expr.operator === "&" && !left.value) return { kind: "ok", value: false };
    if (expr.operator === "|" && left.value) return { kind: "ok", value: true };

    const right = await evaluateConditionExpr(expr.right, devices, session);
    if (right.kind === "error") return right;

    return { kind: "ok", value: right.value };
  }

  return { kind: "ok", value: false };
}

async function evaluateSimpleCondition(
  condition: SimpleCondition,
  devices: Device[],
  session: Session,
): Promise<ConditionEvalResult> {
  const property = lastPropertyName(condition.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(condition.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    return {
      kind: "error",
      message: "Ambiguous device in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)",
    };
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      message: "No devices found for @if condition",
    };
  }

  if (resolutionResult.devices.length > 1) {
    return {
      kind: "error",
      message: "Multiple devices matched in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)",
    };
  }

  const device = resolutionResult.devices[0]!;
  const currentValue = await device.driver.getProperty(device.id, property, device.driverConfig);

  session.it = device;

  return { kind: "ok", value: evaluateCondition(condition, currentValue) };
}
