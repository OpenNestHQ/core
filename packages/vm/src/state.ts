import type { Program, DeviceRef, CollectionRef } from "@opennest/lang-core";
import type { Session } from "./types.js";

export function createSession(): Session {
  return {
    variables: {},
    it: null,
    history: [],
    cursor: 0,
    resolvedIds: {},
    variableResolvedIds: {},
    variableModifiers: {},
  };
}

export function applyResolution(
  session: Session,
  deviceType: string,
  deviceId: string,
  variableName?: string,
): Session {
  session.resolvedIds[deviceType] = deviceId;
  if (variableName) {
    session.variableResolvedIds[variableName] = deviceId;
  }
  return session;
}

export function resolveAmbiguity(
  session: Session,
  deviceType: string,
  deviceId: string,
  program: Program,
): Session {
  const stmt = program.statements[session.cursor];
  let variableName: string | undefined;

  if (stmt && stmt.kind !== "if") {
    if (stmt.kind === "variable_assignment") {
      variableName = stmt.name;
    } else if (stmt.path.length > 0) {
      const firstSeg = stmt.path[0]!;
      if (firstSeg.isVariable) {
        variableName = firstSeg.identifier;
      }
    }
  }

  return applyResolution(session, deviceType, deviceId, variableName);
}

export function resolveLastAmbiguity(
  session: Session,
  deviceId: string,
  program: Program,
): Session {
  const stmt = program.statements[session.cursor];
  let deviceType = "unknown";
  let variableName: string | undefined;

  if (stmt && stmt.kind !== "if") {
    if (stmt.kind === "variable_assignment") {
      variableName = stmt.name;
      if (stmt.value.kind === "device_ref") {
        deviceType = (stmt.value as DeviceRef).deviceType;
      } else if (stmt.value.kind === "collection") {
        deviceType = (stmt.value as CollectionRef).device.deviceType;
      }
    } else if (stmt.path.length > 0) {
      const firstSeg = stmt.path[0]!;
      if (firstSeg.isVariable) {
        variableName = firstSeg.identifier;
        const varRef = session.variables[firstSeg.identifier];
        if (varRef) {
          deviceType = varRef.deviceType;
        }
      } else {
        deviceType = firstSeg.identifier;
      }
    }
  }

  return applyResolution(session, deviceType, deviceId, variableName);
}
