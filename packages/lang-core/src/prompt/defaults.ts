import type { DeviceDefinition, RoomDefinition } from "./types.js";

export const DEFAULT_DEVICES: DeviceDefinition[] = [
  {
    type: "tv",
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
    capabilities: [
      { kind: "property", name: "power", type: "power" },
      { kind: "property", name: "brightness", type: "number", range: [0, 100] },
      { kind: "property", name: "color", type: "string" },
      { kind: "property", name: "mode", type: "string" },
    ],
  },
  {
    type: "speaker",
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
    capabilities: [
      { kind: "property", name: "temperature", type: "number" },
    ],
  },
  {
    type: "fan",
    capabilities: [
      { kind: "property", name: "power", type: "power" },
      { kind: "property", name: "speed", type: "number", range: [0, 3] },
    ],
  },
  {
    type: "blind",
    capabilities: [
      { kind: "property", name: "position", type: "number", range: [0, 100] },
    ],
  },
  {
    type: "camera",
    capabilities: [
      { kind: "action", name: "snapshot" },
    ],
  },
  {
    type: "vacuum",
    capabilities: [
      { kind: "action", name: "start" },
      { kind: "action", name: "stop" },
    ],
  },
  {
    type: "nightstand",
    capabilities: [
      { kind: "property", name: "light.power", type: "power" },
      { kind: "property", name: "brightness", type: "number", range: [0, 100] },
    ],
  },
  {
    type: "door",
    capabilities: [
      { kind: "action", name: "lock" },
      { kind: "action", name: "unlock" },
      { kind: "property", name: "state", type: "string" },
    ],
  },
  {
    type: "switch",
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
