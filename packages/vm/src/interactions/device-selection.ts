import type { Session, Device } from "../types.js";
import type {
  InteractionHandler,
  DeviceSelectionInteraction,
  UserResponse,
} from "./types.js";

export interface DeviceSelectionContext {
  devices: Device[];
  deviceType: string;
  variableName: string | undefined;
}

let nextId = 0;
function generateId(): string {
  return `interaction_${++nextId}_${Date.now().toString(36)}`;
}

export const deviceSelectionHandler: InteractionHandler<DeviceSelectionContext> =
  {
    type: "device_selection",

    createInteraction(
      context: DeviceSelectionContext,
    ): DeviceSelectionInteraction {
      const devices = context.devices.map((d) => ({
        id: d.id,
        name: d.name,
        type: d.type,
        room: d.room,
      }));

      return {
        id: generateId(),
        type: "device_selection",
        message: `Multiple "${context.deviceType}" devices found. Please select one:`,
        devices,
      };
    },

    processResponse(
      session: Session,
      context: DeviceSelectionContext,
      response: UserResponse,
    ): void {
      if (response.type !== "device_selection") return;

      const selected = context.devices.find((d) => d.id === response.deviceId);
      if (!selected) return;

      session.resolvedIds[context.deviceType] = selected.id;
      if (context.variableName) {
        session.variableResolvedIds[context.variableName] = selected.id;
      }
    },
  };
