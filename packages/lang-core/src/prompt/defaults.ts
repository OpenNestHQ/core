import type { DeviceDefinition, RoomDefinition } from "./types.js";

export const DEFAULT_DEVICES: DeviceDefinition[] = [
  {
    type: "tv",
    description: "Television set — for watching content, streaming, and multimedia",
    capabilities: [
      { kind: "property", name: "power", type: "power" },
      { kind: "property", name: "volume", type: "number", range: [0, 100] },
      { kind: "property", name: "source", type: "enum", values: ["hdmi1", "hdmi2", "tv", "netflix"] },
      { kind: "property", name: "channel", type: "number" },
      { kind: "action", name: "play" },
      { kind: "action", name: "pause" },
    ],
  },
  {
    type: "light",
    description: "Ceiling or wall light — main room illumination",
    capabilities: [
      { kind: "property", name: "power", type: "power" },
      { kind: "property", name: "brightness", type: "number", range: [0, 100] },
      { kind: "property", name: "color", type: "string" },
      { kind: "property", name: "mode", type: "string" },
    ],
  },
  {
    type: "speaker",
    description: "Music speaker — for audio playback and media control",
    capabilities: [
      { kind: "property", name: "power", type: "power" },
      { kind: "property", name: "volume", type: "number", range: [0, 100] },
      { kind: "action", name: "play" },
      { kind: "action", name: "pause" },
      { kind: "action", name: "next" },
    ],
  },
  {
    type: "thermostat",
    description: "Room thermostat — controls heating/cooling temperature",
    capabilities: [
      { kind: "property", name: "temperature", type: "number" },
    ],
  },
  {
    type: "fan",
    description: "Ventilation fan — for air circulation and cooling",
    capabilities: [
      { kind: "property", name: "power", type: "power" },
      { kind: "property", name: "speed", type: "number", range: [0, 3] },
    ],
  },
  {
    type: "blind",
    description: "Motorized blind/shutter — controls window covering position",
    capabilities: [
      { kind: "property", name: "position", type: "number", range: [0, 100] },
    ],
  },
  {
    type: "camera",
    description: "Security camera — captures snapshots, no video streaming",
    capabilities: [
      { kind: "action", name: "snapshot" },
    ],
  },
  {
    type: "vacuum",
    description: "Robot vacuum cleaner — autonomous floor cleaning",
    capabilities: [
      { kind: "action", name: "start" },
      { kind: "action", name: "stop" },
    ],
  },
  {
    type: "nightstand",
    description: "Bedside nightstand — secondary/ambient light, not main illumination",
    capabilities: [
      { kind: "property", name: "light.power", type: "power" },
      { kind: "property", name: "brightness", type: "number", range: [0, 100] },
    ],
  },
  {
    type: "door",
    description: "Smart door — controls lock/unlock state",
    capabilities: [
      { kind: "action", name: "lock" },
      { kind: "action", name: "unlock" },
      { kind: "property", name: "state", type: "string" },
    ],
  },
  {
    type: "switch",
    description: "Generic on/off switch — for simple power control of any device",
    capabilities: [
      { kind: "property", name: "power", type: "power" },
    ],
  },
];

export const DEFAULT_ROOMS: RoomDefinition[] = [
  { name: "salon" },
  { name: "chambre" },
  { name: "cuisine" },
  { name: "bureau" },
  { name: "salle_de_bain" },
  { name: "entrée" },
];
