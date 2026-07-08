import type { PromptOptions, DeviceDefinition, RoomDefinition, Capability, PropertyCapability, ActionCapability } from "./types.js";
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
  const lines: string[] = ["# SUPPORTED DEVICES", "", "Supported device types:", ""];

  for (const device of devices) {
    const desc = device.description ? ` — ${device.description}` : "";
    lines.push(`- ${device.type}${desc}`);
  }

  lines.push("", "Do not invent new device types.", "");
  return lines.join("\n");
}

function renderRoomsSection(rooms: RoomDefinition[]): string {
  const lines: string[] = [
    "# ROOMS",
    "",
    "Rooms are specified using bracket selectors:",
    "",
  ];

  for (const room of rooms) {
    lines.push(`- ${room.name}`);
  }

  lines.push("", "Room selector syntax:", "");
  lines.push("- device[room_name] — targets a specific room");
  lines.push("- light[*] — targets ALL rooms (bypasses ambiguity, batch execution)");

  lines.push(
    "",
    "Rooms are logical labels — they describe where a device is placed.",
    "Devices are matched to rooms at runtime based on the actual inventory.",
    "",
    "The wildcard [*] bypasses ambiguity: light[*].power = off",
    "turns off lights in every room without requiring resolution.",
    "",
    "[*] can be combined with @all: @all(light[*]) stores all lights",
    "from every room in a single variable.",
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

    if (device.type === "nightstand") {
      lines.push("");
      lines.push("Note: `light.power` is a single property name (not a nested path).");
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
    "## Variable assignment",
    "$tv = tv[salon]",
    "",
    "$lights = @all(light[salon])",
    "$firstTv = @first(tv) (selects the first matching device)",
    "",
    "`@all` and `@first` are collection modifiers.",
    "They are only valid in variable assignments, never inline in property paths.",
    "",
    "## Variable usage",
    "$tv.power = on",
    "",
    "$lights.power = off",
    "",
    "Variables are prefixed with $ (both when defining and using).",
    "A variable stores a device or collection reference for reuse.",
    "",
    "Variable constraints:",
    "- Room selectors on variables are invalid:",
    "  $tv[salon].power = on → INVALID",
    "- $it is read-only (auto-managed at runtime):",
    "  $it = tv[salon] → INVALID",
    "- Variables remember their collection modifier.",
    "  $lights = @all(light[salon]) keeps @all semantics.",
    "- $it is auto-set after every successful device resolution.",
    "  It persists across statements and across calls within a session.",
    "- Using $it as the first statement of a program has no effect —",
    "  it will not be set yet.",
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
    "$it.power = off",
    "$it.volume = 20",
    "",
    "`$it` refers to the most recently resolved device.",
    "",
  ].join("\n");
}

function renderMultipleInstructionsSection(): string {
  return [
    "# MULTIPLE INSTRUCTIONS",
    "",
    "Each instruction occupies one line.",
    "Later statements can reference earlier results via `$it`.",
    "",
    "Example:",
    "tv.power = on",
    "$it.volume = 20",
    "",
    "`$it` is only available when the previous instruction resolved",
    "successfully without ambiguity. If tv.power = on cannot be resolved",
    "(ambiguous), $it is not set for the next line.",
    "",
  ].join("\n");
}

function renderUsageGuidelinesSection(): string {
  return [
    "# USAGE GUIDELINES",
    "",
    "- Device expressions are always abstract (device type level).",
    "- Do not use device-specific IDs — keep expressions generic.",
    "- If a property or action might not exist for the target device,",
    "  it is still valid DSL — the runtime handles invalid operations.",
    "",
    "Valid:",
    "tv.power = on",
    "",
    "Invalid:",
    "device(tv_lg_001).power = on",
    "",
  ].join("\n");
}

function renderInvalidPatternsSection(): string {
  return [
    "# INVALID PATTERNS",
    "",
    "The following patterns are not valid HomeDSL:",
    "",
    "$tv[salon].power = on     — room selector on variable",
    "$it = tv[salon]             — reassigning read-only $it",
    "$it.power = on              — $it used before being set",
    "tv.brightness = 50          — TV has no brightness property",
    "                              (still valid syntax, runtime handles)",
    "",
  ].join("\n");
}

function renderAmbiguitySection(): string {
  return [
    "# AMBIGUITY RESOLUTION",
    "",
    "When a device expression matches multiple devices, the runtime returns",
    "a waiting state with a candidate list. The caller must pick a device",
    "and re-submit the program.",
    "",
    "Example:",
    "",
    '"Turn on the TV"',
    "→ tv.power = on",
    "",
    "If there are multiple TVs, the runtime returns a waiting state —",
    "the DSL itself does not specify which TV.",
    "",
    "Devices can be pre-resolved before execution:",
    "- session.resolvedIds stores resolved device choices",
    "- applyResolution() picks a specific device",
    "",
  ].join("\n");
}

function renderGeneralPrincipleSection(): string {
  return [
    "# GENERAL PRINCIPLE",
    "",
    "HomeDSL describes intent at the device-type level.",
    "It does not assume which specific devices exist or where they are.",
    "",
    "The runtime handles:",
    "- device selection (matching type + room to inventory)",
    "- room disambiguation",
    "- candidate resolution and filtering",
    "",
  ].join("\n");
}

function renderFormatSection(): string {
  return [
    "# OUTPUT FORMAT",
    "",
    "HomeDSL output consists of raw DSL lines, one per line.",
    "No markdown fences (```), no backticks, no explanatory text.",
    "",
    "If a request cannot be expressed in HomeDSL,",
    "output nothing (empty response).",
    "",
  ].join("\n");
}

function renderExamplesSection(userExamples?: string[]): string {
  const lines: string[] = [
    "# EXAMPLES",
    "",
    '"Turn on the living room TV"',
    "→ tv[salon].power = on",
    "",
    '"Turn on the TV"',
    "→ tv.power = on",
    "",
    '"Turn it off"',
    "→ $it.power = off",
    "",
    '"Set temperature to 21"',
    "→ thermostat.temperature = 21",
    "",
    '"Turn off all lights"',
    "→ light[*].power = off",
    "",
    '"Play music"',
    "→ speaker.play()",
    "",
    '"Turn on the first TV"',
    "→ $tv = @first(tv)",
    "$tv.power = on",
    "",
    '"Turn off all office lights"',
    "→ $officeLights = @all(light[bureau])",
    "$officeLights.power = off",
    "",
    '"What\'s the living room temperature?"',
    "→ thermostat[salon].temperature?",
    "",
    '"Lock the front door"',
    "→ door[entrée].lock()",
    "",
    '"Dim the bedroom light to 20%"',
    "→ light[chambre].brightness = 20",
    "",
    '"Stop the vacuum and turn on the camera"',
    "→ vacuum.stop()",
    "camera.snapshot()",
    "",
  ];

  if (userExamples && userExamples.length > 0) {
    for (const example of userExamples) {
      lines.push(example);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderHeaderSection(): string {
  return [
    "---",
    "",
    "# HomeDSL Language Reference",
    "",
    "HomeDSL is a declarative language for controlling smart home devices.",
    "HomeDSL programs consist of a sequence of instructions.",
    "Statements execute sequentially, top to bottom.",
    "Later statements can depend on earlier ones via `$it`.",
    "",
  ].join("\n");
}

function renderAdditionalRulesSection(rules: string[]): string {
  const lines: string[] = ["---", "", "# ADDITIONAL RULES", ""];

  for (const rule of rules) {
    lines.push(`- ${rule}`);
  }

  lines.push("");
  return lines.join("\n");
}

function renderCustomInstructionSection(instruction: string): string {
  return `\n---\n\n# CUSTOM INSTRUCTIONS\n\n${instruction}\n`;
}

export class OpenNestPrompt {
  private devices: DeviceDefinition[];
  private rooms: RoomDefinition[];

  constructor(devices?: DeviceDefinition[], rooms?: RoomDefinition[]) {
    this.devices = devices ?? DEFAULT_DEVICES;
    this.rooms = rooms ?? DEFAULT_ROOMS;
  }

  prompt(options?: PromptOptions): string {
    const preamble = options?.preamble;
    const userExamples = options?.examples;
    const additionalRules = options?.additionalRules;
    const customInstruction = options?.customInstruction;

    const sections: string[] = [];

    if (preamble !== undefined) {
      sections.push(`${preamble.trim()}`);
    }

    sections.push(
      renderHeaderSection(),
      "",
      "---",
      "",
      renderSupportedDevicesSection(this.devices),
      renderRoomsSection(this.rooms),
      renderCapabilitiesSection(this.devices),
      renderSyntaxSection(),
      renderMultipleInstructionsSection(),
      "---",
      "",
      renderUsageGuidelinesSection(),
      "---",
      "",
      renderInvalidPatternsSection(),
      "---",
      "",
      renderAmbiguitySection(),
      "---",
      "",
      renderGeneralPrincipleSection(),
      "---",
      "",
      renderFormatSection(),
      "---",
      "",
      renderExamplesSection(userExamples),
    );

    if (additionalRules && additionalRules.length > 0) {
      sections.push(renderAdditionalRulesSection(additionalRules));
    }

    if (customInstruction !== undefined) {
      sections.push(renderCustomInstructionSection(customInstruction));
    }

    return sections.join("\n");
  }
}

export { DEFAULT_DEVICES, DEFAULT_ROOMS };
export type { PromptOptions, DeviceDefinition, RoomDefinition, Capability, PropertyCapability, ActionCapability };
