import type { Program } from "@opennest/lang-core";
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

  if (stmt && stmt.kind !== "variable_assignment") {
    if (stmt.path.length > 0) {
      const identifier = stmt.path[0]!.identifier;
      if (identifier in session.variables) {
        variableName = identifier;
      }
    }
  }

  return applyResolution(session, deviceType, deviceId, variableName);
}
