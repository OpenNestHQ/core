import type { CollectionRef, Segment } from "@opennest/lang-core";
import type { Device, Session, ResolutionResult } from "./types.js";
import { resolveDevices } from "./resolver.js";

export function expandCollection(
  collection: CollectionRef,
  devices: Device[],
  session: Session,
): ResolutionResult {
  const pseudoSegments: Segment[] = [
    {
      identifier: collection.device.deviceType,
      roomSelector: collection.device.roomSelector,
    },
  ];

  const result = resolveDevices(pseudoSegments, devices, session);

  return result;
}

export function selectFirst(
  devices: Device[],
): Device | null {
  if (devices.length === 0) return null;
  return devices[0]!;
}

export function selectAll(
  devices: Device[],
): Device[] {
  return devices;
}
