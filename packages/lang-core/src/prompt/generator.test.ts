import { describe, it, expect } from "vitest";
import { generateHomeAgentPrompt, DEFAULT_DEVICES, DEFAULT_ROOMS } from "./generator.js";
import type { DeviceDefinition, RoomDefinition, PropertyCapability, ActionCapability } from "./types.js";

function makeDevice(type: string, capabilities: Array<PropertyCapability | ActionCapability>): DeviceDefinition {
  return { type, capabilities };
}

function makeProp(name: string, type: PropertyCapability["type"], range?: [number, number], values?: string[]): PropertyCapability {
  const cap: PropertyCapability = { kind: "property", name, type };
  if (range) cap.range = range;
  if (values) cap.values = values;
  return cap;
}

function makeAction(name: string): ActionCapability {
  return { kind: "action", name };
}

describe("DEFAULT_DEVICES", () => {
  it("should contain all 11 default device types", () => {
    expect(DEFAULT_DEVICES).toHaveLength(11);
    const types = DEFAULT_DEVICES.map((d) => d.type);
    expect(types).toEqual([
      "tv", "light", "speaker", "thermostat", "fan",
      "blind", "camera", "vacuum", "nightstand", "door", "switch",
    ]);
  });

  it("should have capabilities for every device", () => {
    for (const device of DEFAULT_DEVICES) {
      expect(device.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("should have tv with power, volume, source, channel, play, pause", () => {
    const tv = DEFAULT_DEVICES.find((d) => d.type === "tv");
    expect(tv).toBeDefined();
    const names = tv!.capabilities.map((c) => c.name);
    expect(names).toContain("power");
    expect(names).toContain("volume");
    expect(names).toContain("source");
    expect(names).toContain("channel");
    expect(names).toContain("play");
    expect(names).toContain("pause");
  });
});

describe("DEFAULT_ROOMS", () => {
  it("should contain 6 default rooms", () => {
    expect(DEFAULT_ROOMS).toHaveLength(6);
    const names = DEFAULT_ROOMS.map((r) => r.name);
    expect(names).toEqual([
      "salon", "chambre", "cuisine", "bureau", "salle_de_bain", "entrée",
    ]);
  });
});

describe("generateHomeAgentPrompt", () => {
  // --- Default prompt structure ---

  describe("with default config", () => {
    const prompt = generateHomeAgentPrompt();

    it("should start with the header", () => {
      expect(prompt).toContain("# HomeAgent — HomeDSL Compiler");
      expect(prompt).toContain("You are a HomeDSL compiler for a smart home system.");
    });

    it("should contain the Home DSL overview", () => {
      expect(prompt).toContain("# HOME DSL OVERVIEW");
      expect(prompt).toContain("HomeDSL is a minimal language to control smart home devices.");
    });

    it("should list all supported devices", () => {
      expect(prompt).toContain("# SUPPORTED DEVICES");
      for (const device of DEFAULT_DEVICES) {
        expect(prompt).toContain(`- ${device.type}`);
      }
      expect(prompt).toContain("Never invent new device types.");
    });

    it("should contain the rooms section", () => {
      expect(prompt).toContain("# ROOMS (logical grouping only)");
      for (const room of DEFAULT_ROOMS.slice(0, 4)) {
        expect(prompt).toContain(`- ${room.name}`);
      }
      expect(prompt).toContain("Rooms are NOT authoritative.");
    });

    it("should contain the capabilities section with all device details", () => {
      expect(prompt).toContain("# CAPABILITIES");
      expect(prompt).toContain("## TV");
      expect(prompt).toContain("Properties:");

      // Check TV capabilities appear
      const capSection = prompt.substring(
        prompt.indexOf("## TV"),
        prompt.indexOf("## LIGHT"),
      );
      expect(capSection).toContain("- power (on/off)");
      expect(capSection).toContain("- volume (0–100)");
      expect(capSection).toContain("- source (hdmi1, hdmi2, tv, netflix)");
      expect(capSection).toContain("Actions (callable):");
      expect(capSection).toContain("- play()");
      expect(capSection).toContain("- pause()");
    });

    it("should render door capabilities correctly", () => {
      expect(prompt).toContain("## DOOR");
      expect(prompt).toContain("- lock()");
      expect(prompt).toContain("- unlock()");
      expect(prompt).toContain("- state (optional)");
    });

    it("should render switch capabilities correctly", () => {
      expect(prompt).toContain("## SWITCH");
      // Switch only has properties, no actions
      const capSection = prompt.substring(
        prompt.indexOf("## SWITCH"),
        prompt.indexOf("# SYNTAX"),
      );
      expect(capSection).toContain("Properties:");
      expect(capSection).toContain("- power (on/off)");
    });

    it("should contain the syntax section", () => {
      expect(prompt).toContain("# SYNTAX");
      expect(prompt).toContain("## State assignment");
      expect(prompt).toContain("## Query");
      expect(prompt).toContain("## Increment");
      expect(prompt).toContain("## Action");
      expect(prompt).toContain("## Context reference");
    });

    it("should contain the static sections", () => {
      expect(prompt).toContain("# MULTIPLE INSTRUCTIONS");
      expect(prompt).toContain("# CONTEXT RULES");
      expect(prompt).toContain("# AMBIGUITY HANDLING");
      expect(prompt).toContain("# IMPORTANT PRINCIPLE");
      expect(prompt).toContain("# EXAMPLES");
    });

    it("should contain example DSL patterns", () => {
      expect(prompt).toContain("tv[salon].power = on");
      expect(prompt).toContain("tv.power = on");
      expect(prompt).toContain("it.power = off");
      expect(prompt).toContain("thermostat.temperature = 21");
      expect(prompt).toContain("light[*].power = off");
      expect(prompt).toContain("speaker.play()");
    });

    it("should not contain custom instructions when none provided", () => {
      expect(prompt).not.toContain("# CUSTOM INSTRUCTIONS");
    });
  });

  // --- Custom devices ---

  describe("with custom devices", () => {
    const customDevices: DeviceDefinition[] = [
      makeDevice("tv", [makeProp("power", "power"), makeAction("play")]),
      makeDevice("light", [makeProp("power", "power"), makeProp("brightness", "number", [0, 100])]),
    ];

    const prompt = generateHomeAgentPrompt({ devices: customDevices });

    it("should only list the provided devices", () => {
      expect(prompt).toContain("- tv");
      expect(prompt).toContain("- light");
      expect(prompt).not.toContain("- speaker");
      expect(prompt).not.toContain("- thermostat");
    });

    it("should only show capabilities for the provided devices", () => {
      expect(prompt).toContain("## TV");
      expect(prompt).toContain("- power (on/off)");
      expect(prompt).toContain("- play()");
      expect(prompt).toContain("## LIGHT");
      expect(prompt).toContain("- brightness (0–100)");
      expect(prompt).not.toContain("## SPEAKER");
    });

    it("should still contain non-device sections", () => {
      expect(prompt).toContain("# SYNTAX");
      expect(prompt).toContain("# CONTEXT RULES");
      expect(prompt).toContain("# EXAMPLES");
    });
  });

  // --- Custom rooms ---

  describe("with custom rooms", () => {
    const customRooms: RoomDefinition[] = [
      { name: "garage" },
      { name: "jardin" },
    ];

    const prompt = generateHomeAgentPrompt({ rooms: customRooms });

    it("should only list the provided rooms", () => {
      expect(prompt).toContain("- garage");
      expect(prompt).toContain("- jardin");
      expect(prompt).not.toContain("- salon");
      expect(prompt).not.toContain("- chambre");
    });

    it("should still contain room selector examples", () => {
      expect(prompt).toContain("- device[room_name]");
      expect(prompt).toContain("- light[*] (all rooms)");
    });
  });

  // --- Custom instruction ---

  describe("with custom instruction", () => {
    const instruction = "Always prefer salon when no room is specified.";
    const prompt = generateHomeAgentPrompt({ customInstruction: instruction });

    it("should append the custom instruction section", () => {
      expect(prompt).toContain("# CUSTOM INSTRUCTIONS");
      expect(prompt).toContain(instruction);
    });

    it("should place custom instructions after the main content", () => {
      const examplesIndex = prompt.indexOf("# EXAMPLES");
      const customIndex = prompt.indexOf("# CUSTOM INSTRUCTIONS");
      expect(customIndex).toBeGreaterThan(examplesIndex);
    });
  });

  // --- Empty configs ---

  describe("with empty devices array", () => {
    const prompt = generateHomeAgentPrompt({ devices: [] });

    it("should still produce a valid prompt", () => {
      expect(prompt).toContain("# HomeAgent — HomeDSL Compiler");
      expect(prompt).toContain("# SUPPORTED DEVICES");
      expect(prompt).toContain("# CAPABILITIES");
    });

    it("should not list any device types", () => {
      const devicesSection = prompt.substring(
        prompt.indexOf("# SUPPORTED DEVICES"),
        prompt.indexOf("# ROOMS"),
      );
      expect(devicesSection).not.toContain("- tv");
      expect(devicesSection).not.toContain("- light");
    });
  });

  describe("with empty rooms array", () => {
    const prompt = generateHomeAgentPrompt({ rooms: [] });

    it("should still produce a valid rooms section", () => {
      expect(prompt).toContain("# ROOMS (logical grouping only)");
    });

    it("should not list default room names", () => {
      const roomsText = prompt.substring(
        prompt.indexOf("# ROOMS"),
        prompt.indexOf("# CAPABILITIES"),
      );
      expect(roomsText).not.toContain("- salon");
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("should not throw with undefined config", () => {
      expect(() => generateHomeAgentPrompt()).not.toThrow();
    });

    it("should not throw with null-like empty config", () => {
      expect(() => generateHomeAgentPrompt({})).not.toThrow();
    });

    it("should produce the same result for no args and empty object", () => {
      const a = generateHomeAgentPrompt();
      const b = generateHomeAgentPrompt({});
      expect(a).toBe(b);
    });

    it("should render device with no capabilities", () => {
      const prompt = generateHomeAgentPrompt({
        devices: [makeDevice("sensor", [])],
        rooms: [],
      });
      expect(prompt).toContain("## SENSOR");
      expect(prompt).toContain("- sensor");
    });

    it("should render property without range and without values", () => {
      const prompt = generateHomeAgentPrompt({
        devices: [makeDevice("test", [makeProp("mode", "string")])],
        rooms: [],
      });
      expect(prompt).toContain("- mode (optional)");
    });

    it("should NOT render range for number when no range provided", () => {
      const prompt = generateHomeAgentPrompt({
        devices: [makeDevice("test", [makeProp("count", "number")])],
        rooms: [],
      });
      expect(prompt).toContain("- count");
      expect(prompt).not.toContain("count (");
    });

    it("should NOT render (optional) for power type", () => {
      const prompt = generateHomeAgentPrompt({
        devices: [makeDevice("test", [makeProp("power", "power")])],
        rooms: [],
      });
      expect(prompt).toContain("- power (on/off)");
      expect(prompt).not.toContain("power (optional)");
    });

    it("should handle rooms with more than 4 entries (only first 4 listed)", () => {
      const rooms: RoomDefinition[] = Array.from({ length: 10 }, (_, i) => ({
        name: `room_${i}`,
      }));
      const prompt = generateHomeAgentPrompt({ rooms });
      expect(prompt).toContain("- room_0");
      expect(prompt).toContain("- room_3");
      expect(prompt).not.toContain("- room_4");
      expect(prompt).not.toContain("- room_9");
    });
  });
});

describe("capability rendering", () => {
  it("should render power properties as name (on/off)", () => {
    const prompt = generateHomeAgentPrompt({
      devices: [makeDevice("plug", [makeProp("power", "power")])],
      rooms: [],
    });
    expect(prompt).toContain("- power (on/off)");
  });

  it("should render number properties with range as name (min–max)", () => {
    const prompt = generateHomeAgentPrompt({
      devices: [makeDevice("dimmer", [makeProp("level", "number", [1, 10])])],
      rooms: [],
    });
    expect(prompt).toContain("- level (1–10)");
  });

  it("should render enum properties with values", () => {
    const prompt = generateHomeAgentPrompt({
      devices: [
        makeDevice("media", [
          makeProp("input", "enum", undefined, ["hdmi", "usb", "bluetooth"]),
        ]),
      ],
      rooms: [],
    });
    expect(prompt).toContain("- input (hdmi, usb, bluetooth)");
  });

  it("should render string properties as name (optional)", () => {
    const prompt = generateHomeAgentPrompt({
      devices: [makeDevice("display", [makeProp("label", "string")])],
      rooms: [],
    });
    expect(prompt).toContain("- label (optional)");
  });

  it("should render actions as name()", () => {
    const prompt = generateHomeAgentPrompt({
      devices: [makeDevice("robot", [makeAction("start"), makeAction("stop")])],
      rooms: [],
    });
    expect(prompt).toContain("- start()");
    expect(prompt).toContain("- stop()");
  });
});

describe("section ordering", () => {
  const prompt = generateHomeAgentPrompt();

  function sectionOrder(sections: string[]) {
    const indices = sections.map((s) => prompt.indexOf(s));
    for (let i = 1; i < indices.length; i++) {
      const prev = indices[i - 1];
      const curr = indices[i];
      if (prev === undefined || curr === undefined) continue;
      expect(curr, `"${sections[i]}" should come after "${sections[i - 1]}"`)
        .toBeGreaterThan(prev);
    }
  }

  it("should have sections in the expected order", () => {
    sectionOrder([
      "# HomeAgent — HomeDSL Compiler",
      "# HOME DSL OVERVIEW",
      "# SUPPORTED DEVICES",
      "# ROOMS (logical grouping only)",
      "# CAPABILITIES",
      "# SYNTAX",
      "# MULTIPLE INSTRUCTIONS",
      "# CONTEXT RULES",
      "# AMBIGUITY HANDLING",
      "# IMPORTANT PRINCIPLE",
      "# EXAMPLES",
    ]);
  });
});
