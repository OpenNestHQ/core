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
      return interpretVariableAssignment(statement, session);
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

function interpretVariableAssignment(
  stmt: VariableAssignment,
  session: Session,
): InterpretResult {
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
  const condition = stmt.condition;
  const property = lastPropertyName(condition.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(condition.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    return {
      kind: "error",
      errors: [{
        statement: stmt,
        message: "Ambiguous device in @if condition — use a variable to pre-resolve the device",
      }],
    };
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [{
        statement: stmt,
        message: "No devices found for @if condition",
      }],
    };
  }

  if (resolutionResult.devices.length > 1) {
    return {
      kind: "error",
      errors: [{
        statement: stmt,
        message: "Multiple devices matched in @if condition — use a specific room selector or variable",
      }],
    };
  }

  const device = resolutionResult.devices[0]!;
  const currentValue = await device.driver.getProperty(device.id, property, device.driverConfig);
  const conditionMet = evaluateCondition(condition, currentValue);

  session.it = device;

  const statementsToExecute = conditionMet ? stmt.body : (stmt.elseBody ?? []);

  for (const bodyStmt of statementsToExecute) {
    const result = await interpretStatement(bodyStmt, devices, session);
    if (result.kind !== "success") {
      return result;
    }
  }

  session.history.push({
    statement: stmt,
    resolvedDevices: [device],
    changes: [{
      deviceId: device.id,
      property: `condition:${property}`,
      oldValue: currentValue,
      newValue: currentValue,
    }],
  });

  return { kind: "success" };
}
