import type { PromptConfig, DeviceDefinition, RoomDefinition, Capability, PropertyCapability, ActionCapability } from "./types.js";
import { DEFAULT_DEVICES, DEFAULT_ROOMS } from "./defaults.js";

function renderPropertyCapability(cap: PropertyCapability): string {
  const parts: string[] = [cap.name];

  if (cap.type === "power") {
    parts.push("(on/off)");
  } else if (cap.type === "number" && cap.range) {
    parts.push(`(${cap.range[0]}–${cap.range[1]})`);
  } else if (cap.type === "enum" && cap.values) {
    parts.push(`(${cap.values.join(", ")})`);
  } else if (cap.type === "string") {
    parts.push("(optional)");
  }

  return parts.join(" ");
}

function renderActionCapability(cap: ActionCapability): string {
  return `${cap.name}()`;
}

function renderCapability(cap: Capability): string {
  if (cap.kind === "property") {
    return renderPropertyCapability(cap);
  }
  return renderActionCapability(cap);
}

function renderSupportedDevicesSection(devices: DeviceDefinition[]): string {
  const lines: string[] = ["# SUPPORTED DEVICES", "", "You may ONLY use these device types:", ""];

  for (const device of devices) {
    lines.push(`- ${device.type}`);
  }

  lines.push("", "Never invent new device types.", "");
  return lines.join("\n");
}

function renderRoomsSection(rooms: RoomDefinition[]): string {
  const lines: string[] = [
    "# ROOMS (logical grouping only)",
    "",
    "You may refer to rooms using bracket selectors:",
    "",
  ];

  for (const room of rooms.slice(0, 4)) {
    lines.push(`- ${room.name}`);
  }

  lines.push("", "Examples of room selectors:", "");
  lines.push("- device[room_name]");
  lines.push("- light[*] (all rooms)");

  lines.push(
    "",
    "IMPORTANT:",
    "Rooms are NOT authoritative.",
    "Do NOT assume device placement correctness.",
    "Let interpret_home_dsl resolve actual mapping.",
    ""
  );

  return lines.join("\n");
}

function renderCapabilitiesSection(devices: DeviceDefinition[]): string {
  const lines: string[] = ["# CAPABILITIES", "", "Each device supports a subset of capabilities:", ""];

  for (const device of devices) {
    lines.push(`## ${device.type.toUpperCase()}`);

    const properties = device.capabilities.filter((c) => c.kind === "property");
    const actions = device.capabilities.filter((c) => c.kind === "action");

    if (properties.length > 0) {
      lines.push("Properties:");
      for (const cap of properties) {
        lines.push(`- ${renderCapability(cap)}`);
      }
    }

    if (actions.length > 0) {
      if (properties.length > 0) lines.push("");
      lines.push("Actions (callable):");
      for (const cap of actions) {
        lines.push(`- ${renderCapability(cap)}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

function renderSyntaxSection(): string {
  return [
    "# SYNTAX",
    "",
    "## State assignment",
    "tv[salon].power = on",
    "",
    "light[chambre].brightness = 50",
    "",
    "## Query",
    "tv.power?",
    "",
    "thermostat.temperature?",
    "",
    "## Increment",
    "speaker.volume += 10",
    "",
    "## Action",
    "vacuum.start()",
    "",
    "camera.snapshot()",
    "",
    "## Context reference",
    "it.power = off",
    "it.volume = 20",
    "",
    'Use `it` ONLY when referring to last resolved device or selection.',
    "",
  ].join("\n");
}

function renderStaticSections(): string {
  return [
    "# MULTIPLE INSTRUCTIONS",
    "",
    "One action per line:",
    "",
    "User:",
    "Turn on the TV and set volume to 20",
    "",
    "Output:",
    "tv.power = on",
    "it.volume = 20",
    "",
    "---",
    "",
    "# CONTEXT RULES",
    "",
    "- Do NOT resolve which specific device exists",
    "- Do NOT choose between multiple TVs",
    "- Always keep expressions abstract when ambiguous",
    "",
    "GOOD:",
    "tv.power = on",
    "",
    "BAD:",
    "device(tv_lg_001).power = on",
    "",
    "---",
    "",
    "# AMBIGUITY HANDLING",
    "",
    "If user request is ambiguous:",
    "",
    "Still generate abstract DSL.",
    "",
    "Example:",
    "",
    "User:",
    "Turn on the TV",
    "",
    "You still output:",
    "tv.power = on",
    "",
    "DO NOT ask questions.",
    "",
    "interpret_home_dsl will handle resolution and return:",
    "- waiting state OR",
    "- execution OR",
    "- candidate list",
    "",
    "---",
    "",
    "# IMPORTANT PRINCIPLE",
    "",
    "Your role is a COMPILER, not a planner.",
    "",
    "You convert intent → DSL only.",
    "",
    "All reasoning about:",
    "- device selection",
    "- room disambiguation",
    "- candidate resolution",
    "",
    "is handled by interpret_home_dsl.",
    "",
    "---",
    "",
    "# EXAMPLES",
    "",
    "User:",
    "Turn on the living room TV",
    "",
    "→",
    "tv[salon].power = on",
    "",
    "User:",
    "Turn on the TV",
    "",
    "→",
    "tv.power = on",
    "",
    "User:",
    "Turn it off",
    "",
    "→",
    "it.power = off",
    "",
    "User:",
    "Set temperature to 21",
    "",
    "→",
    "thermostat.temperature = 21",
    "",
    "User:",
    "Turn off all lights",
    "",
    "→",
    "light[*].power = off",
    "",
    "User:",
    "Play music",
    "",
    "→",
    "speaker.play()",
    "",
  ].join("\n");
}

export function generateHomeAgentPrompt(config?: PromptConfig): string {
  const devices = config?.devices ?? DEFAULT_DEVICES;
  const rooms = config?.rooms ?? DEFAULT_ROOMS;
  const toolName = config?.toolName ?? "interpret_home_dsl";
  const customInstruction = config?.customInstruction;

  const header = [
    "# HomeAgent — HomeDSL Compiler",
    "",
    "You are a HomeDSL compiler for a smart home system.",
    "",
    "Your only responsibility is to convert user requests into a valid HomeDSL program",
    `and send it to the tool \`${toolName}\`.`,
    "",
    "You MUST NOT:",
    "- resolve devices yourself",
    "- access or assume inventory details",
    "- ask clarification questions before calling the tool",
    "- execute actions directly",
    "- return natural language instead of DSL",
    "",
    "You ONLY produce HomeDSL.",
    "",
    "---",
    "",
    "# TOOL",
    "",
    "You must always call:",
    "",
    `${toolName}(program)`,
    "",
    "where `program` is a valid HomeDSL script.",
    "",
    "---",
    "",
    "# HOME DSL OVERVIEW",
    "",
    "HomeDSL is a minimal language to control smart home devices.",
    "",
    "A program is a sequence of instructions.",
    "",
    "---",
    "",
  ].join("\n");

  const supportedDevices = renderSupportedDevicesSection(devices);
  const roomsSection = renderRoomsSection(rooms);
  const capabilities = renderCapabilitiesSection(devices);
  const syntax = renderSyntaxSection();
  const staticSections = renderStaticSections();

  const toolCallFormat = [
    "",
    "---",
    "",
    "# TOOL CALL FORMAT",
    "",
    "After generating DSL, immediately call:",
    "",
    `${toolName}(program)`,
  ].join("\n");

  let prompt = [
    header,
    supportedDevices,
    roomsSection,
    capabilities,
    syntax,
    staticSections,
    toolCallFormat,
  ].join("\n");

  if (customInstruction) {
    prompt += `\n\n---\n\n# CUSTOM INSTRUCTIONS\n\n${customInstruction}\n`;
  }

  return prompt;
}

export { DEFAULT_DEVICES, DEFAULT_ROOMS };
export type { PromptConfig, DeviceDefinition, RoomDefinition, Capability, PropertyCapability, ActionCapability };
