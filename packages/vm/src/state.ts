import type { Session } from "./types.js";

export function createSession(): Session {
  return {
    variables: {},
    it: null,
    history: [],
    cursor: 0,
    resolvedIds: {},
    variableModifiers: {},
  };
}

export function applyResolution(
  session: Session,
  deviceType: string,
  deviceId: string,
): Session {
  session.resolvedIds[deviceType] = deviceId;
  return session;
}
