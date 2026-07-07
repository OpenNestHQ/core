import type { Segment } from "@opennest/lang-core";
import type {
  Device,
  Session,
  ResolutionResult,
  ResolutionIntent,
  ResolutionFilter,
  ExcludedDevice,
} from "./types.js";

export function resolveDevices(
  segments: Segment[],
  devices: Device[],
  session: Session,
  intent?: ResolutionIntent,
): ResolutionResult {
  const firstSegment = segments[0];
  if (!firstSegment) {
    return { devices: [], ambiguous: false };
  }

  const isContextRef = firstSegment.identifier === "it";
  const isVariableRef = firstSegment.identifier in session.variables;

  if (isVariableRef) {
    return resolveVariableRef(firstSegment.identifier, segments, devices, session, intent);
  }

  if (isContextRef) {
    return resolveContextRef(session, intent);
  }

  const deviceType = firstSegment.identifier;
  const roomSelector = firstSegment.roomSelector;

  return resolveByTypeAndRoom(deviceType, roomSelector, devices, intent, session, false);
}

function resolveVariableRef(
  varName: string,
  segments: Segment[],
  devices: Device[],
  session: Session,
  intent?: ResolutionIntent,
): ResolutionResult {
  const resolvedId = session.variableResolvedIds[varName];
  if (resolvedId) {
    const device = resolveDeviceById(resolvedId, devices);
    if (device) {
      if (intent) {
        const filter = buildFilter([device], intent);
        if (filter.matched > 0) {
          return { devices: [device], ambiguous: false, filter };
        }
        return { devices: [], ambiguous: false, filter };
      }
      return { devices: [device], ambiguous: false };
    }
  }

  const ref = session.variables[varName];
  if (!ref) {
    return { devices: [], ambiguous: false };
  }
  const forceAll = session.variableModifiers[varName] === "@all";
  return resolveByTypeAndRoom(ref.deviceType, ref.roomSelector, devices, intent, session, forceAll);
}

function resolveContextRef(
  session: Session,
  intent?: ResolutionIntent,
): ResolutionResult {
  if (session.it) {
    if (intent) {
      const filter = buildFilter([session.it], intent);
      if (filter.matched === 0) {
        return { devices: [], ambiguous: false, filter };
      }
      return { devices: [session.it], ambiguous: false, filter };
    }
    return { devices: [session.it], ambiguous: false };
  }
  return { devices: [], ambiguous: false };
}

function resolveByTypeAndRoom(
  deviceType: string,
  roomSelector: { kind: "room"; name: string } | { kind: "wildcard" } | null,
  devices: Device[],
  intent?: ResolutionIntent,
  session?: Session,
  forceAll?: boolean,
): ResolutionResult {
  let matches = devices.filter((d) => d.type === deviceType);

  if (roomSelector) {
    if (roomSelector.kind === "room") {
      matches = matches.filter((d) => d.room === roomSelector.name);
    }
  }

  let filter: ResolutionFilter | undefined;
  if (intent) {
    const candidates = matches.length;
    const result = applyIntentFilter(matches, intent);
    matches = result.matched;
    filter = {
      candidates,
      matched: matches.length,
      excluded: result.excluded,
    };
  }

  if (matches.length === 0) {
    return { devices: [], ambiguous: false, ...(filter ? { filter } : {}) };
  }

  if (matches.length === 1) {
    return { devices: matches, ambiguous: false, ...(filter ? { filter } : {}) };
  }

  if (roomSelector?.kind === "wildcard") {
    return { devices: matches, ambiguous: false, ...(filter ? { filter } : {}) };
  }

  if (forceAll) {
    return { devices: matches, ambiguous: false, ...(filter ? { filter } : {}) };
  }

  if (session?.resolvedIds[deviceType]) {
    const chosen = matches.find((d) => d.id === session.resolvedIds[deviceType]);
    if (chosen) {
      return { devices: [chosen], ambiguous: false, ...(filter ? { filter } : {}) };
    }
  }

  return { devices: matches, ambiguous: true, ...(filter ? { filter } : {}) };
}

export function resolveDeviceById(
  deviceId: string,
  devices: Device[],
): Device | null {
  return devices.find((d) => d.id === deviceId) ?? null;
}

function applyIntentFilter(
  candidates: Device[],
  intent: ResolutionIntent,
): { matched: Device[]; excluded: ExcludedDevice[] } {
  const matched: Device[] = [];
  const excluded: ExcludedDevice[] = [];

  for (const device of candidates) {
    if (hasCapability(device, intent)) {
      matched.push(device);
    } else {
      excluded.push({
        deviceId: device.id,
        deviceName: device.name,
        reason:
          intent.kind === "property"
            ? "property_not_supported"
            : "action_not_supported",
        details:
          intent.kind === "property"
            ? `${device.name} (${device.type}[${device.room}]) does not support property '${intent.name}'`
            : `${device.name} (${device.type}[${device.room}]) does not support action '${intent.name}'`,
      });
    }
  }

  return { matched, excluded };
}

function hasCapability(device: Device, intent: ResolutionIntent): boolean {
  const config = device.driverConfig as {
    properties?: Record<string, unknown>;
    actions?: string[];
  };

  const hasDeclaredProperties = "properties" in config;
  const hasDeclaredActions = "actions" in config;
  const noCapabilityDeclared = !hasDeclaredProperties && !hasDeclaredActions;

  if (noCapabilityDeclared) {
    return true;
  }

  if (intent.kind === "property") {
    const props = config.properties;
    if (!props) return false;
    return intent.name in props;
  }

  if (intent.kind === "action") {
    const actions = config.actions;
    if (!actions) return false;
    return actions.includes(intent.name);
  }

  return false;
}

function buildFilter(
  devices: Device[],
  intent: ResolutionIntent,
): ResolutionFilter {
  const candidates = devices.length;
  const result = applyIntentFilter(devices, intent);
  return {
    candidates,
    matched: result.matched.length,
    excluded: result.excluded,
  };
}
