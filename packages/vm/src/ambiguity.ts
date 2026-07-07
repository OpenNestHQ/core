import type {
  Device,
  AmbiguityInfo,
  AmbiguityTreeDevice,
  AmbiguityTreeRoom,
  AmbiguityTreeNode,
} from "./types.js";

export function buildAmbiguityInfo(devices: Device[]): AmbiguityInfo {
  return {
    kind: "target",
    tree: buildAmbiguityTree(devices),
  };
}

export function buildAmbiguityTree(devices: Device[]): AmbiguityTreeNode {
  const roomMap = new Map<string, AmbiguityTreeDevice[]>();

  for (const d of devices) {
    const room = d.room;
    const child: AmbiguityTreeDevice = {
      key: d.name,
      id: d.id,
      dsl: `device(${d.id})`,
    };
    const existing = roomMap.get(room);
    if (existing) {
      existing.push(child);
    } else {
      roomMap.set(room, [child]);
    }
  }

  const type = devices[0]?.type ?? "unknown";
  const children: AmbiguityTreeRoom[] = [];

  for (const [room, roomDevices] of roomMap) {
    children.push({
      key: room,
      dsl: `${type}[${room}]`,
      children: roomDevices,
    });
  }

  return { type, children };
}
