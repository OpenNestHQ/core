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

  const errors: VMError[] = [];
  let awaiting = false;
  let interactionResult: UserInteraction | null = null;

  for (let i = session.cursor; i < program.statements.length; i++) {
    const statement = program.statements[i]!;
    const result = await interpretStatement(statement, devices, session, policies);

    if (result.kind === "awaiting_interaction") {
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
      errors.push(...result.errors);
    }

    session.resolvedIds = {};

    session.cursor = i + 1;
  }

  if (!awaiting) {
    session.cursor = 0;
    delete session._pendingProgram;
  }

  if (awaiting) {
    return {
      status: "awaiting_interaction",
      session,
      executed: session.history,
      interaction: interactionResult,
      errors,
    };
  }

  if (errors.length > 0) {
    return {
      status: "error",
      session,
      executed: session.history,
      interaction: null,
      errors,
    };
  }

  return {
    status: "success",
    session,
    executed: session.history,
    interaction: null,
    errors: [],
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
): Promise<InterpretResult> {
  switch (statement.kind) {
    case "assignment":
      return interpretAssignment(statement, devices, session, policies);
    case "query":
      return interpretQuery(statement, devices, session, policies);
    case "increment":
      return interpretIncrement(statement, devices, session, policies);
    case "action":
      return interpretAction(statement, devices, session, policies);
    case "variable_assignment":
      return interpretVariableAssignment(statement, devices, session);
    case "if":
      return interpretIfStatement(statement, devices, session, policies);
  }
}

function awaitDeviceSelection(
  result: ResolutionResult,
  deviceType: string,
  variableName?: string,
): InterpretResult {
  const ctx: DeviceSelectionContext = {
    devices: result.devices,
    deviceType,
    variableName,
  };
  return {
    kind: "awaiting_interaction",
    interaction: createInteraction("device_selection", ctx),
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
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName);
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for path` }],
    };
  }

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "set_property" as const,
    device,
    property,
    value: stmt.value,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult);
}

async function interpretQuery(
  stmt: Query,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName);
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for query` }],
    };
  }

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "read_property" as const,
    device,
    property,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult);
}

async function interpretIncrement(
  stmt: Increment,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
): Promise<InterpretResult> {
  const property = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "property", name: property };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName);
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for increment` }],
    };
  }

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "increment_property" as const,
    device,
    property,
    value: stmt.value,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult);
}

async function interpretAction(
  stmt: Action,
  devices: Device[],
  session: Session,
  policies?: ExecutionPolicy[],
): Promise<InterpretResult> {
  const method = lastPropertyName(stmt.path);
  const intent: ResolutionIntent = { kind: "action", name: method };
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent);

  if (resolutionResult.ambiguous) {
    const { deviceType, variableName } = extractDeviceContext(stmt.path, session);
    return awaitDeviceSelection(resolutionResult, deviceType, variableName);
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: "error",
      errors: [{ statement: stmt, message: `No devices found for action` }],
    };
  }

  const actions: PlannedAction[] = resolutionResult.devices.map((device) => ({
    kind: "invoke_action" as const,
    device,
    method,
  }));

  return applyPoliciesAndFinish(actions, policies, session, devices, stmt, resolutionResult);
}

async function applyPoliciesAndFinish(
  actions: PlannedAction[],
  policies: ExecutionPolicy[] | undefined,
  session: Session,
  devices: Device[],
  statement: Statement,
  resolutionResult: ResolutionResult,
): Promise<InterpretResult> {
  if (!policies || policies.length === 0) {
    const changes = await Promise.all(
      actions.map((action) => executePlannedAction(action)),
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
    const outcome = await runPolicyPipeline(action, policies, env);

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
    approved.map((action) => executePlannedAction(action)),
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
        return awaitDeviceSelection(
          resolutionResult,
          stmt.value.device.deviceType,
          stmt.name,
        );
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
  policies?: ExecutionPolicy[],
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
    const result = await interpretStatement(bodyStmt, devices, session, policies);
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
