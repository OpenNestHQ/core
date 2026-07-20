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
import type { Device, Session, VMResult, VMError, ResolutionIntent, ResolutionResult } from "./types.js";
import type { UserInteraction } from "./interactions/types.js";
import type { DeviceSelectionContext } from "./interactions/device-selection.js";
import type { ExecutionPolicy, PlannedAction } from "./policies/types.js";
import type { ExecutionTracer } from "./trace/types.js";
import { NodeKind } from "./trace/types.js";
import { createSession } from "./state.js";
import { resolveDevices } from "./resolver.js";
import { validateProgram } from "./validate.js";
import { createInteraction } from "./interactions/registry.js";
import {
  executePlannedAction,
  evaluateCondition,
} from "./executor.js";
import { runPolicyPipeline } from "./policies/pipeline.js";

export async function interpretProgram(
  program: Program,
  devices: Device[],
  existingSession?: Session,
  policies?: ExecutionPolicy[],
  tracer?: ExecutionTracer,
): Promise<VMResult> {
  const session = existingSession ?? createSession();
  const isFresh = !existingSession || existingSession.cursor === 0;

  if (isFresh) {
    const validationErrors = validateProgram(program, devices, session);
    if (validationErrors.length > 0) {
      return {
        status: "error",
        session,
        executed: [],
        interaction: null,
        errors: validationErrors,
      };
    }
  }

  tracer?.beginNode(NodeKind.Program, "program");
  tracer?.attribute("statementCount", program.statements.length);

  const errors: VMError[] = [];
  let awaiting = false;
  let interactionResult: UserInteraction | null = null;

  for (let i = session.cursor; i < program.statements.length; i++) {
    const statement = program.statements[i]!;

    tracer?.beginNode(NodeKind.Statement, `statement[${i}]`);
    tracer?.attribute("index", i);
    tracer?.attribute("kind", statement.kind);

    const result = await interpretStatement(statement, devices, session, policies, tracer);

    if (result.kind === "awaiting_interaction") {
      tracer?.endWaiting();
      awaiting = true;
      interactionResult = result.interaction;
      session.pendingInteraction = {
        id: result.interaction.id,
        type: result.interaction.type,
        context: result.pendingContext,
      };
      session._pendingProgram = program;
      session.cursor = i;
      break;
    }

    if (result.kind === "error") {
      tracer?.endFailed();
      errors.push(...result.errors);
    } else {
      tracer?.endSuccess();
    }

    session.resolvedIds = {};

    session.cursor = i + 1;
  }

  if (!awaiting) {
    session.cursor = 0;
    delete session._pendingProgram;
  }

  if (awaiting) {
    tracer?.endWaiting();
    const trace = tracer?.getTrace();
    return {
      status: "awaiting_interaction",
      session,
      executed: session.history,
      interaction: interactionResult,
      errors,
      ...(trace ? { trace } : {}),
    };
  }

  if (errors.length > 0) {
    tracer?.endFailed();
    const trace = tracer?.getTrace();
    return {
      status: "error",
      session,
      executed: session.history,
      interaction: null,
      errors,
      ...(trace ? { trace } : {}),
    };
  }

  tracer?.endSuccess();
  const trace = tracer?.getTrace();
  return {
    status: "success",
    session,
    executed: session.history,
    interaction: null,
    errors: [],
    ...(trace ? { trace } : {}),
  };
}

type InterpretResult =
  | { kind: "success" }
  | { kind: "awaiting_interaction"; interaction: UserInteraction; pendingContext: unknown }
  | { kind: "error"; errors: VMError[] };

async function interpretStatement(
  statement: Statement,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
  tracer?: ExecutionTracer,
): Promise<InterpretResult> {
  switch (statement.kind) {
    case "assignment":
      return interpretAssignment(statement, devices, session, policies, tracer);
    case "query":
      return interpretQuery(statement, devices, session, policies, tracer);
    case "increment":
      return interpretIncrement(statement, devices, session, policies, tracer);
    case "action":
      return interpretAction(statement, devices, session, policies, tracer);
    case "variable_assignment":
      return interpretVariableAssignment(statement, devices, session, tracer);
    case "if":
      return interpretIfStatement(statement, devices, session, policies, tracer);
  }
}

function awaitDeviceSelection(
  result: ResolutionResult,
  deviceType: string,
  variableName?: string,
  tracer?: ExecutionTracer,
): InterpretResult {
  tracer?.beginNode(NodeKind.Handler, `handler:device_selection`);
  tracer?.attribute("interactionType", "device_selection");
  tracer?.attribute("candidates", result.devices.length);

  const ctx: DeviceSelectionContext = {
    devices: result.devices,
    deviceType,
    variableName,
  };
  const interaction = createInteraction("device_selection", ctx, tracer);

  tracer?.endWaiting();

  return {
    kind: "awaiting_interaction",
    interaction,
    pendingContext: ctx,
  };
}

function extractDeviceContext(
  path: { identifier: string; isVariable?: boolean }[],
  session: Session,
): { deviceType: string; variableName: string | undefined } {
  const firstSeg = path[0];
  if (!firstSeg) return { deviceType: "unknown", variableName: undefined };

  if (firstSeg.isVariable) {
    const varRef = session.variables[firstSeg.identifier];
    return {
      deviceType: varRef?.deviceType ?? firstSeg.identifier,
      variableName: firstSeg.identifier,
    };
  }

  return { deviceType: firstSeg.identifier, variableName: undefined };
}

async function interpretAssignment(
  stmt: Assignment,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
  tracer?: ExecutionTracer,
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };

  tracer?.beginNode(NodeKind.ResolveDevice, formatPath(stmt.path));
  tracer?.attribute("intent", "property");
  tracer?.attribute("property", property);

  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    tracer?.attribute("ambiguous", true);
    tracer?.attribute("matched", resolutionResult.devices.length);
    tracer?.endWaiting();
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName, tracer);
  }

  if (resolutionResult.devices.length === 0) {
    tracer?.attribute("matched", 0);
    tracer?.endFailed("No devices found");
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for path` }],
    };
  }

  tracer?.attribute("matched", resolutionResult.devices.length);
  if (resolutionResult.filter) {
    tracer?.attribute("candidates", resolutionResult.filter.candidates);
    tracer?.attribute("excluded", resolutionResult.filter.excluded.length);
  }
  tracer?.endSuccess();

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "set_property" as const,
    device,
    property,
    value: stmt.value,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult, tracer);
}

async function interpretQuery(
  stmt: Query,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
  tracer?: ExecutionTracer,
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };

  tracer?.beginNode(NodeKind.ResolveDevice, formatPath(stmt.path));
  tracer?.attribute("intent", "property");
  tracer?.attribute("property", property);

  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    tracer?.attribute("ambiguous", true);
    tracer?.attribute("matched", resolutionResult.devices.length);
    tracer?.endWaiting();
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName, tracer);
  }

  if (resolutionResult.devices.length === 0) {
    tracer?.attribute("matched", 0);
    tracer?.endFailed("No devices found");
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for query` }],
    };
  }

  tracer?.attribute("matched", resolutionResult.devices.length);
  tracer?.endSuccess();

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "read_property" as const,
    device,
    property,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult, tracer);
}

async function interpretIncrement(
  stmt: Increment,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
  tracer?: ExecutionTracer,
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };

  tracer?.beginNode(NodeKind.ResolveDevice, formatPath(stmt.path));
  tracer?.attribute("intent", "property");
  tracer?.attribute("property", property);

  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    tracer?.attribute("ambiguous", true);
    tracer?.attribute("matched", resolutionResult.devices.length);
    tracer?.endWaiting();
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName, tracer);
  }

  if (resolutionResult.devices.length === 0) {
    tracer?.attribute("matched", 0);
    tracer?.endFailed("No devices found");
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for increment` }],
    };
  }

  tracer?.attribute("matched", resolutionResult.devices.length);
  tracer?.endSuccess();

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "increment_property" as const,
    device,
    property,
    value: stmt.value,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult, tracer);
}

async function interpretAction(
  stmt: Action,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
  tracer?: ExecutionTracer,
): Promise<InterpretResult> {
  const method = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "action", name: method };

  tracer?.beginNode(NodeKind.ResolveDevice, formatPath(stmt.path));
  tracer?.attribute("intent", "action");
  tracer?.attribute("method", method);

  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    tracer?.attribute("ambiguous", true);
    tracer?.attribute("matched", resolutionResult.devices.length);
    tracer?.endWaiting();
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName, tracer);
  }

  if (resolutionResult.devices.length === 0) {
    tracer?.attribute("matched", 0);
    tracer?.endFailed("No devices found");
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for action` }],
    };
  }

  tracer?.attribute("matched", resolutionResult.devices.length);
  tracer?.endSuccess();

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "invoke_action" as const,
    device,
    method,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult, tracer);
}

async function applyPoliciesAndFinish(
  actions: PlannedAction[],
  policies: ExecutionPolicy[] | undefined,
  session: Session,
  devices: Device[],
  statement: Statement,
  resolutionResult: ResolutionResult,
  tracer?: ExecutionTracer,
): Promise<InterpretResult> {
  if (!policies || policies.length === 0) {
    const changes = await Promise.all(
      actions.map((action) => traceAndExecute(action, tracer)),
    );

    session.history.push({
      statement,
      resolvedDevices: resolutionResult.devices,
      changes,
      ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
    });

    if (resolutionResult.devices[0]) {
      session.it = resolutionResult.devices[0];
    }

    return { kind: "success" };
  }

  const env = { session, devices };
  const approved: PlannedAction[] = [];

  for (const action of actions) {
    const outcome = await runPolicyPipeline(action, policies, env, tracer);

    switch (outcome.kind) {
      case "execute":
        approved.push(...outcome.actions);
        break;

      case "blocked":
        return {
          kind: "error",
          errors: [{
            statement,
            message: `Blocked by policy "${outcome.policyName}": ${outcome.reason}`,
          }],
        };

      case "skipped":
        continue;

      case "paused":
        tracer?.beginNode(NodeKind.Handler, `handler:${outcome.interaction.type}`);
        tracer?.attribute("interactionType", outcome.interaction.type);
        tracer?.endWaiting();
        return {
          kind: "awaiting_interaction",
          interaction: outcome.interaction,
          pendingContext: outcome.context ?? null,
        };
    }
  }

  if (approved.length === 0) {
    session.history.push({
      statement,
      resolvedDevices: resolutionResult.devices,
      changes: [],
      ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
    });

    return { kind: "success" };
  }

  const changes = await Promise.all(
    approved.map((action) => traceAndExecute(action, tracer)),
  );

  const resolvedIds = new Set(approved.map((a) => a.device.id));
  const executedDevices = resolutionResult.devices.filter((d) => resolvedIds.has(d.id));

  session.history.push({
    statement,
    resolvedDevices: executedDevices,
    changes,
    ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
  });

  if (executedDevices[0]) {
    session.it = executedDevices[0];
  }

  return { kind: "success" };
}

async function traceAndExecute(
  action: PlannedAction,
  tracer?: ExecutionTracer,
): Promise<import("./types.js").StateChange> {
  tracer?.beginNode(NodeKind.Execute, `execute:${action.kind}`);
  tracer?.attribute("deviceId", action.device.id);
  tracer?.attribute("deviceName", action.device.name);

  switch (action.kind) {
    case "set_property":
    case "read_property":
    case "increment_property":
      tracer?.attribute("property", action.property);
      if (action.kind === "set_property" || action.kind === "increment_property") {
        tracer?.attribute("value", describeActionValue(action.value));
      }
      break;
    case "invoke_action":
      tracer?.attribute("method", action.method);
      break;
  }

  try {
    const change = await executePlannedAction(action);
    tracer?.endSuccess();
    return change;
  } catch (err) {
    tracer?.endFailed(err);
    throw err;
  }
}

function describeActionValue(value: import("@opennest/lang-core").Value): string {
  switch (value.kind) {
    case "power": return value.value;
    case "number": return String(value.value);
    case "string": return `"${value.value}"`;
    case "identifier": return value.value;
  }
}

async function interpretVariableAssignment(
  stmt: VariableAssignment,
  devices: Device[],
  session: Session,
  tracer?: ExecutionTracer,
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

      tracer?.beginNode(NodeKind.ResolveDevice, `@oneof(${stmt.value.device.deviceType})`);
      tracer?.attribute("intent", "variable");

      const resolutionResult = resolveDevices(pseudoSegments, devices, session);

      if (resolutionResult.ambiguous) {
        tracer?.attribute("ambiguous", true);
        tracer?.attribute("matched", resolutionResult.devices.length);
        tracer?.endWaiting();
        return awaitDeviceSelection(
          resolutionResult,
          stmt.value.device.deviceType,
          stmt.name,
          tracer,
        );
      }

      if (resolutionResult.devices.length === 0) {
        tracer?.attribute("matched", 0);
        tracer?.endFailed("No devices found");
        return {
          kind: "error",
          errors: [{
            statement: stmt,
            message: `No devices found for @oneof(${stmt.value.device.deviceType})`,
          }],
        };
      }

      tracer?.attribute("matched", 1);
      tracer?.endSuccess();

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

function formatPath(path: { identifier: string; roomSelector?: { kind: string; name?: string } | null }[]): string {
  return path
    .map((seg) => {
      const room = seg.roomSelector;
      if (room && room.kind === "room" && room.name) return `${seg.identifier}[${room.name}]`;
      if (room && room.kind === "wildcard") return `${seg.identifier}[*]`;
      return seg.identifier;
    })
    .join(".");
}

async function interpretIfStatement(
  stmt: IfStatement,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
  tracer?: ExecutionTracer,
): Promise<InterpretResult> {
  const evalResult = await evaluateConditionExpr(stmt.condition, devices, session, tracer);

  if (evalResult.kind === "error") {
    return {
      kind: "error",
      errors: [{ statement: stmt, message: evalResult.message }],
    };
  }

  const conditionMet = evalResult.value;

  const statementsToExecute = conditionMet ? stmt.body : (stmt.elseBody ?? []);

  for (const bodyStmt of statementsToExecute) {
    const result = await interpretStatement(bodyStmt, devices, session, policies, tracer);
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
  tracer?: ExecutionTracer,
): Promise<ConditionEvalResult> {
  if (expr.kind === "condition") {
    return evaluateSimpleCondition(expr, devices, session, tracer);
  }

  if (expr.kind === "compound_condition") {
    const left = await evaluateConditionExpr(expr.left, devices, session, tracer);
    if (left.kind === "error") return left;

    if (expr.operator === "&" && !left.value) return { kind: "ok", value: false };
    if (expr.operator === "|" && left.value) return { kind: "ok", value: true };

    const right = await evaluateConditionExpr(expr.right, devices, session, tracer);
    if (right.kind === "error") return right;

    return { kind: "ok", value: right.value };
  }

  return { kind: "ok", value: false };
}

async function evaluateSimpleCondition(
  condition: SimpleCondition,
  devices: Device[],
  session: Session,
  tracer?: ExecutionTracer,
): Promise<ConditionEvalResult> {
  const property = lastPropertyName(condition.path);
  const intent: ResolutionIntent = { kind: "property", name: property };

  tracer?.beginNode(NodeKind.ResolveDevice, formatPath(condition.path));
  tracer?.attribute("intent", "property");
  tracer?.attribute("property", property);

  const resolutionResult = resolveDevices(condition.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    tracer?.attribute("ambiguous", true);
    tracer?.endFailed("Ambiguous device in condition");
    return {
      kind: "error",
      message: "Ambiguous device in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)",
    };
  }

  if (resolutionResult.devices.length === 0) {
    tracer?.attribute("matched", 0);
    tracer?.endFailed("No devices found");
    return {
      kind: "error",
      message: "No devices found for @if condition",
    };
  }

  if (resolutionResult.devices.length > 1) {
    tracer?.attribute("matched", resolutionResult.devices.length);
    tracer?.endFailed("Multiple devices in condition");
    return {
      kind: "error",
      message: "Multiple devices matched in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)",
    };
  }

  tracer?.attribute("matched", 1);
  tracer?.endSuccess();

  const device = resolutionResult.devices[0]!;
  const currentValue = await device.driver.getProperty(device.id, property, device.driverConfig);

  session.it = device;

  return { kind: "ok", value: evaluateCondition(condition, currentValue) };
}
