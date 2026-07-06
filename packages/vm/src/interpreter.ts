import type {
  Program,
  Statement,
  Assignment,
  Query,
  Increment,
  Action,
  VariableAssignment,
  DeviceRef,
} from "@opennest/lang-core";
import type { Device, Session, VMResult, VMError } from "./types.js";
import type { AmbiguityInfo } from "./types.js";
import { createSession } from "./state.js";
import { resolveDevices } from "./resolver.js";
import { buildAmbiguityInfo } from "./ambiguity.js";
import {
  executeAssignment,
  executeIncrement,
  executeQuery,
  executeAction,
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

  for (const statement of program.statements) {
    const result = await interpretStatement(statement, devices, session);

    if (result.kind === "waiting") {
      awaiting = true;
      ambiguityInfo = result.ambiguity;
      break;
    }

    if (result.kind === "error") {
      errors.push(...result.errors);
    }
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
  }
}

async function interpretAssignment(
  stmt: Assignment,
  devices: Device[],
  session: Session,
): Promise<InterpretResult> {
  const resolutionResult = resolveDevices(stmt.path, devices, session);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.choices),
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

  const property = lastPropertyName(stmt.path);
  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeAssignment(device, property, stmt.value),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
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
  const resolutionResult = resolveDevices(stmt.path, devices, session);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.choices),
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

  const property = lastPropertyName(stmt.path);
  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeQuery(device, property),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
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
  const resolutionResult = resolveDevices(stmt.path, devices, session);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.choices),
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

  const property = lastPropertyName(stmt.path);
  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeIncrement(device, property, stmt.value),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
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
  const resolutionResult = resolveDevices(stmt.path, devices, session);

  if (resolutionResult.ambiguous) {
    return {
      kind: "waiting",
      ambiguity: buildAmbiguityInfo(resolutionResult.choices),
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

  const method = lastPropertyName(stmt.path);
  const changes = await Promise.all(
    resolutionResult.devices.map((device) =>
      executeAction(device, method),
    ),
  );

  session.history.push({
    statement: stmt,
    resolvedDevices: resolutionResult.devices,
    changes,
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
