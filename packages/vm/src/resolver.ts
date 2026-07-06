import type { Segment } from "@opennest/lang-core";
import type { Device, Session, ResolutionResult, AmbiguityChoice } from "./types.js";

export function resolveDevices(
  segments: Segment[],
  devices: Device[],
  session: Session,
): ResolutionResult {
  const firstSegment = segments[0];
  if (!firstSegment) {
    return { devices: [], ambiguous: false, choices: [] };
  }

  const isContextRef = firstSegment.identifier === "it";
  const isVariableRef = firstSegment.identifier in session.variables;

  if (isVariableRef) {
    return resolveVariableRef(firstSegment.identifier, segments, devices, session);
  }

  if (isContextRef) {
    return resolveContextRef(session);
  }

  const deviceType = firstSegment.identifier;
  const roomSelector = firstSegment.roomSelector;

  return resolveByTypeAndRoom(deviceType, roomSelector, devices);
}

function resolveVariableRef(
  varName: string,
  segments: Segment[],
  devices: Device[],
  session: Session,
): ResolutionResult {
  const ref = session.variables[varName];
  if (!ref) {
    return { devices: [], ambiguous: false, choices: [] };
  }
  return resolveByTypeAndRoom(ref.deviceType, ref.roomSelector, devices);
}

function resolveContextRef(session: Session): ResolutionResult {
  if (session.it) {
    return { devices: [session.it], ambiguous: false, choices: [] };
  }
  return { devices: [], ambiguous: false, choices: [] };
}

function resolveByTypeAndRoom(
  deviceType: string,
  roomSelector: { kind: "room"; name: string } | { kind: "wildcard" } | null,
  devices: Device[],
): ResolutionResult {
  let matches = devices.filter((d) => d.type === deviceType);

  if (roomSelector) {
    if (roomSelector.kind === "room") {
      matches = matches.filter((d) => d.room === roomSelector.name);
    }
  }

  if (matches.length === 0) {
    return { devices: [], ambiguous: false, choices: [] };
  }

  if (matches.length === 1) {
    return { devices: matches, ambiguous: false, choices: [] };
  }

  if (roomSelector) {
    return { devices: matches, ambiguous: false, choices: [] };
  }

  const choices: AmbiguityChoice[] = matches.map((d) => ({
    dsl: `${d.type}[${d.room}]`,
    label: d.name,
  }));

  return { devices: matches, ambiguous: true, choices };
}

export function resolveDeviceById(
  deviceId: string,
  devices: Device[],
): Device | null {
  return devices.find((d) => d.id === deviceId) ?? null;
}
