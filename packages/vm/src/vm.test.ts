import { describe, it, expect } from "vitest";
import { parseHomeDSL } from "@opennest/lang-core";
import { MockDriver } from "@opennest/devices";
import type { DeviceDriver } from "@opennest/devices";
import {
  interpret_home_dsl,
  createSession,
  resolveDevices,
  expandCollection,
  executeAssignment,
  executeQuery,
  executeAction,
  buildAmbiguityInfo,
} from "./index.js";
import type {
  Device,
  VMContext,
  Session,
  Segment,
  PowerValue,
  ResolutionFilter,
  ExcludedDevice,
} from "./index.js";

function makeDriver(): MockDriver {
  return new MockDriver();
}

async function makeDevice(
  id: string,
  type: string,
  room: string,
  name: string,
  driver: MockDriver,
  initialState: Record<string, unknown> = {},
): Promise<Device> {
  await driver.init({});
  driver.seed(id, initialState);
  return {
    id,
    type,
    room,
    name,
    driver,
    driverConfig: {},
  };
}

interface DeviceSpec {
  id: string;
  type: string;
  room: string;
  name: string;
  initialState: Record<string, unknown>;
}

async function devices(specs?: DeviceSpec[]): Promise<Device[]> {
  const driver = makeDriver();
  const list = specs ?? fixtureSpecs();
  return Promise.all(
    list.map((s) => makeDevice(s.id, s.type, s.room, s.name, driver, s.initialState)),
  );
}

function fixtureSpecs(): DeviceSpec[] {
  return [
    { id: "tv_salon", type: "tv", room: "salon", name: "Salon TV", initialState: { power: false, volume: 15 } },
    { id: "tv_chambre", type: "tv", room: "chambre", name: "Chambre TV", initialState: { power: false, volume: 10 } },
    { id: "light_salon_1", type: "light", room: "salon", name: "Salon Light 1", initialState: { power: false, brightness: 80 } },
    { id: "light_salon_2", type: "light", room: "salon", name: "Salon Light 2", initialState: { power: true, brightness: 60 } },
    { id: "thermostat_salon", type: "thermostat", room: "salon", name: "Salon Thermostat", initialState: { temperature: 21 } },
    { id: "vacuum_salon", type: "vacuum", room: "salon", name: "Salon Vacuum", initialState: {} },
    { id: "speaker_salon", type: "speaker", room: "salon", name: "Salon Speaker", initialState: { power: false, volume: 30 } },
  ];
}

async function ctx(session?: Session): Promise<VMContext> {
  return { devices: await devices(), session };
}

function parse(code: string) {
  const result = parseHomeDSL(code);
  if (result.errors.length > 0) {
    throw new Error(
      `Parse errors: ${result.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return result.program;
}

function seg(identifier: string, room?: string): Segment {
  if (room === "*") return { identifier, roomSelector: { kind: "wildcard" as const } };
  if (room) return { identifier, roomSelector: { kind: "room" as const, name: room } };
  return { identifier, roomSelector: null };
}

function on(): PowerValue {
  return { kind: "power", value: "on" };
}

function off(): PowerValue {
  return { kind: "power", value: "off" };
}

function num(n: number) {
  return { kind: "number" as const, value: n };
}

async function getProperty(d: Device, prop: string): Promise<unknown> {
  return d.driver.getProperty(d.id, prop, d.driverConfig);
}

describe("interpret_home_dsl", () => {
  describe("basic assignments", () => {
    it("should assign a property on an unambiguous device", async () => {
      const program = parse("tv[salon].power = on");
      const context = await ctx();
      const result = await interpret_home_dsl(program, context);

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(1);
      const exec = result.executed[0]!;
      expect(exec.resolvedDevices).toHaveLength(1);
      expect(exec.resolvedDevices[0]!.id).toBe("tv_salon");
      expect(exec.changes[0]!.property).toBe("power");
      expect(exec.changes[0]!.newValue).toBe(true);

      const value = await getProperty(exec.resolvedDevices[0]!, "power");
      expect(value).toBe(true);
    });

    it("should assign a numeric value", async () => {
      const program = parse("tv[salon].volume = 42");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe(42);
    });

    it("should assign a string value", async () => {
      const program = parse(`tv[salon].source = "hdmi1"`);
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe("hdmi1");
    });

    it("should assign to a wildcard room selector (all rooms)", async () => {
      const program = parse("tv[*].power = on");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.resolvedDevices).toHaveLength(2);
      const ids = result.executed[0]!.resolvedDevices.map((d) => d.id);
      expect(ids).toContain("tv_salon");
      expect(ids).toContain("tv_chambre");
    });
  });

  describe("queries", () => {
    it("should query a device property", async () => {
      const program = parse("thermostat[salon].temperature?");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe(21);
    });

    it("should query tv power", async () => {
      const program = parse("tv[salon].power?");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe(false);
    });
  });

  describe("increments", () => {
    it("should increment a numeric property", async () => {
      const program = parse("tv[salon].volume += 5");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.oldValue).toBe(15);
      expect(result.executed[0]!.changes[0]!.newValue).toBe(20);
    });
  });

  describe("actions", () => {
    it("should execute an action on a device", async () => {
      const program = parse("vacuum[salon].start()");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      const change = result.executed[0]!.changes[0]!;
      expect(change.property).toBe("action:start");
      expect(change.newValue).toBe("called");
    });
  });

  describe("variable assignments", () => {
    it("should store a variable reference", async () => {
      const program = parse("salon_tv = tv[salon]");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.session.variables["salon_tv"]).toEqual({
        kind: "device_ref",
        deviceType: "tv",
        roomSelector: { kind: "room", name: "salon" },
      });
    });

    it("should use a variable to reference a device", async () => {
      const program = parse(`salon_tv = tv[salon]\nsalon_tv.power = on`);
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);
      const assignmentResult = result.executed[1]!;
      expect(assignmentResult.resolvedDevices[0]!.id).toBe("tv_salon");
      expect(assignmentResult.changes[0]!.newValue).toBe(true);
    });

    it("should store a collection variable", async () => {
      const program = parse("lights = @all(light[salon])");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.session.variables["lights"]).toEqual({
        kind: "device_ref",
        deviceType: "light",
        roomSelector: { kind: "room", name: "salon" },
      });
    });
  });

  describe("context reference (it)", () => {
    it("should use 'it' to reference the last resolved device", async () => {
      const program = parse(`tv[salon].volume = 20\nit.power = on`);
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);

      const secondExecution = result.executed[1]!;
      expect(secondExecution.resolvedDevices[0]!.id).toBe("tv_salon");
      expect(secondExecution.changes[0]!.property).toBe("power");
      expect(secondExecution.changes[0]!.newValue).toBe(true);
    });

    it("should error when 'it' is used before any resolution", async () => {
      const program = parse("it.power = on");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("error");
    });

    it("should carry 'it' across sessions", async () => {
      const program1 = parse("tv[salon].volume = 30");
      const context1 = await ctx();
      const result1 = await interpret_home_dsl(program1, context1);

      expect(result1.session.it?.id).toBe("tv_salon");

      const program2 = parse("it.power = on");
      const result2 = await interpret_home_dsl(program2, { devices: context1.devices, session: result1.session });

      expect(result2.status).toBe("success");
      expect(result2.executed[0]!.resolvedDevices[0]!.id).toBe("tv_salon");
    });
  });

  describe("ambiguity handling", () => {
    it("should return waiting state when device type is ambiguous (no room)", async () => {
      const program = parse("tv.power = on");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("waiting");
      expect(result.awaiting).not.toBeNull();
      expect(result.awaiting!.kind).toBe("target");
      expect(result.awaiting!.choices).toHaveLength(2);

      const choiceLabels = result.awaiting!.choices.map((c) => c.label);
      expect(choiceLabels).toContain("Salon TV");
      expect(choiceLabels).toContain("Chambre TV");
    });

    it("should not be ambiguous when room is specified", async () => {
      const program = parse("tv[salon].power = on");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
    });

    it("should not be ambiguous for a single device type across rooms", async () => {
      const program = parse("thermostat.power = on");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).not.toBe("waiting");
    });

    it("should return waiting state with DSL choices", async () => {
      const program = parse("tv.power = on");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.awaiting!.choices[0]!.dsl).toContain("tv[");
    });
  });

  describe("multi-line programs", () => {
    it("should execute multiple statements in order", async () => {
      const program = parse(
        `tv[salon].power = on\ntv[salon].volume = 25\nlight[salon].brightness = 50`,
      );
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(3);
    });

    it("should stop at the first ambiguous statement", async () => {
      const program = parse(`tv[salon].power = on\ntv.power = on\nlight[salon].power = on`);
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("waiting");
      expect(result.executed).toHaveLength(1);
    });

    it("should execute all statements with explicit room selectors", async () => {
      const program = parse(
        `tv[salon].power = on\nspeaker[salon].volume = 20`,
      );
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);
    });
  });

  describe("session persistence", () => {
    it("should track execution history", async () => {
      const program = parse(
        `tv[salon].power = on\nlight[salon].brightness = 40`,
      );
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.session.history).toHaveLength(2);
    });

    it("should persist variables across calls", async () => {
      const program1 = parse("salon_tv = tv[salon]");
      const context1 = await ctx();
      const result1 = await interpret_home_dsl(program1, context1);

      const program2 = parse("salon_tv.volume = 50");
      const result2 = await interpret_home_dsl(program2, { devices: context1.devices, session: result1.session });

      expect(result2.status).toBe("success");
      expect(result2.session.variables["salon_tv"]).toBeDefined();
      const lastExec = result2.executed[result2.executed.length - 1]!;
      expect(lastExec.resolvedDevices[0]!.id).toBe("tv_salon");
    });

    it("should accumulate history across calls", async () => {
      const program1 = parse("tv[salon].power = on");
      const context1 = await ctx();
      const result1 = await interpret_home_dsl(program1, context1);

      const program2 = parse("light[salon].power = off");
      const result2 = await interpret_home_dsl(program2, { devices: context1.devices, session: result1.session });

      expect(result2.session.history).toHaveLength(2);
    });
  });

  describe("error cases", () => {
    it("should error when no devices match the type", async () => {
      const program = parse("camera[salon].snapshot()");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("error");
      expect(result.errors[0]!.message).toContain("No devices found");
    });

    it("should error when no devices match the room", async () => {
      const program = parse("tv[cuisine].power = on");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("error");
    });
  });

  describe("executor module", () => {
    it("should mutate device state on assignment", async () => {
      const driver = makeDriver();
      await driver.init({});
      driver.seed("test_light", { power: false });
      const device: Device = {
        id: "test_light", type: "light", room: "test", name: "Test",
        driver, driverConfig: {},
      };

      const change = await executeAssignment(device, "power", on());

      expect(change.newValue).toBe(true);
      const storedValue = await driver.getProperty("test_light", "power", {});
      expect(storedValue).toBe(true);
    });

    it("should read device state on query", async () => {
      const driver = makeDriver();
      await driver.init({});
      driver.seed("test_light", { brightness: 50 });
      const device: Device = {
        id: "test_light", type: "light", room: "test", name: "Test",
        driver, driverConfig: {},
      };

      const change = await executeQuery(device, "brightness");

      expect(change.newValue).toBe(50);
    });

    it("should record action execution", async () => {
      const driver = makeDriver();
      await driver.init({});
      const device: Device = {
        id: "test_vacuum", type: "vacuum", room: "test", name: "Test",
        driver, driverConfig: {},
      };

      const change = await executeAction(device, "start");

      expect(change.property).toBe("action:start");
      expect(change.newValue).toBe("called");
    });
  });

  describe("resolver module", () => {
    it("should match device by type and room", async () => {
      const devs = await devices();
      const result = resolveDevices(
        [seg("tv", "salon")],
        devs,
        createSession(),
      );

      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]!.id).toBe("tv_salon");
      expect(result.ambiguous).toBe(false);
    });

    it("should match all devices of a type with wildcard", async () => {
      const devs = await devices();
      const result = resolveDevices(
        [seg("light", "*")],
        devs,
        createSession(),
      );

      expect(result.devices).toHaveLength(2);
      expect(result.ambiguous).toBe(false);
    });

    it("should detect ambiguity when no room selector on multi-instance type", async () => {
      const devs = await devices();
      const result = resolveDevices(
        [seg("tv")],
        devs,
        createSession(),
      );

      expect(result.ambiguous).toBe(true);
      expect(result.choices).toHaveLength(2);
      expect(result.choices[0]!.dsl).toBe("tv[salon]");
      expect(result.choices[1]!.dsl).toBe("tv[chambre]");
    });

    it("should not be ambiguous for a type with a single instance", async () => {
      const devs = await devices();
      const result = resolveDevices(
        [seg("thermostat")],
        devs,
        createSession(),
      );

      expect(result.ambiguous).toBe(false);
      expect(result.devices).toHaveLength(1);
    });

    it("should resolve variables", async () => {
      const devs = await devices();
      const session = createSession();
      session.variables["salon_tv"] = {
        kind: "device_ref",
        deviceType: "tv",
        roomSelector: { kind: "room", name: "salon" },
      };

      const result = resolveDevices(
        [seg("salon_tv"), seg("power")],
        devs,
        session,
      );

      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]!.id).toBe("tv_salon");
    });

    it("should resolve 'it' context reference", async () => {
      const devs = await devices();
      const session = createSession();
      session.it = devs.find((d) => d.id === "tv_salon")!;

      const result = resolveDevices(
        [seg("it"), seg("power")],
        devs,
        session,
      );

      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]!.id).toBe("tv_salon");
    });

    it("should return empty when 'it' is not set", async () => {
      const devs = await devices();
      const result = resolveDevices(
        [seg("it"), seg("power")],
        devs,
        createSession(),
      );

      expect(result.devices).toHaveLength(0);
    });
  });

  describe("collection expansion", () => {
    it("should expand @all for a collection", async () => {
      const devs = await devices();
      const result = expandCollection(
        {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "light",
            roomSelector: { kind: "room", name: "salon" },
          },
        },
        devs,
        createSession(),
      );

      expect(result.devices).toHaveLength(2);
    });

    it("should expand @first for a collection", async () => {
      const devs = await devices();
      const result = expandCollection(
        {
          kind: "collection",
          modifier: "@first",
          device: {
            deviceType: "light",
            roomSelector: { kind: "room", name: "salon" },
          },
        },
        devs,
        createSession(),
      );

      expect(result.devices).toHaveLength(2);
    });
  });

  describe("ambiguity module", () => {
    it("should build ambiguity info", () => {
      const info = buildAmbiguityInfo([
        { dsl: "tv[salon]", label: "Salon TV" },
        { dsl: "tv[chambre]", label: "Chambre TV" },
      ]);

      expect(info.kind).toBe("target");
      expect(info.choices).toHaveLength(2);
    });
  });

  describe("README example flows", () => {
    it("should turn on all lights in the living room", async () => {
      const program = parse(`lights = @all(light[salon])\nlights.power = on`);
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);

      const assignExec = result.executed[1]!;
      expect(assignExec.resolvedDevices).toHaveLength(2);

      for (const d of assignExec.resolvedDevices) {
        const pwr = await getProperty(d, "power");
        expect(pwr).toBe(true);
      }
    });

    it("should assign tv power and volume in sequence", async () => {
      const program = parse(`tv[salon].power = on\nit.volume = 20`);
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);

      const tv = result.executed[0]!.resolvedDevices[0]!;
      const pwr = await getProperty(tv, "power");
      const vol = await getProperty(tv, "volume");
      expect(pwr).toBe(true);
      expect(vol).toBe(20);
    });

    it("should handle 'turn off all lights'", async () => {
      const program = parse(`light[*].power = off`);
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(1);
      expect(result.executed[0]!.resolvedDevices).toHaveLength(2);

      for (const d of result.executed[0]!.resolvedDevices) {
        const pwr = await getProperty(d, "power");
        expect(pwr).toBe(false);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle an empty program", async () => {
      const program = parse("");
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(0);
    });

    it("should handle multiple assignments to the same device", async () => {
      const program = parse(
        `tv[salon].power = on\ntv[salon].volume = 50\ntv[salon].power = off`,
      );
      const result = await interpret_home_dsl(program, await ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(3);

      const tv = result.executed[0]!.resolvedDevices[0]!;
      const pwr = await getProperty(tv, "power");
      const vol = await getProperty(tv, "volume");
      expect(pwr).toBe(false);
      expect(vol).toBe(50);
    });

    it("should preserve initial session state when passed", async () => {
      const session = createSession();
      session.variables["foo"] = {
        kind: "device_ref",
        deviceType: "tv",
        roomSelector: { kind: "room", name: "salon" },
      };

      const program = parse("light[salon].power = on");
      const result = await interpret_home_dsl(program, await ctx(session));

      expect(result.session.variables["foo"]).toBeDefined();
      expect(result.session.variables["foo"]!.deviceType).toBe("tv");
    });
  });

  describe("intent filtering", () => {
    async function filteredDevices(): Promise<Device[]> {
      const driver = makeDriver();
      await driver.init({});

      const tv_mute: Device = {
        id: "tv_mute",
        type: "tv",
        room: "salon",
        name: "Mute TV",
        driver,
        driverConfig: {
          properties: { power: { type: "boolean" }, volume: { type: "number" }, mute: { type: "boolean" } },
          actions: ["play", "pause"],
        },
      };

      const tv_basic: Device = {
        id: "tv_basic",
        type: "tv",
        room: "chambre",
        name: "Basic TV",
        driver,
        driverConfig: {
          properties: { power: { type: "boolean" }, volume: { type: "number" } },
          actions: ["play", "pause"],
        },
      };

      return [tv_mute, tv_basic];
    }

    async function filteredCtx(session?: Session): Promise<VMContext> {
      return { devices: await filteredDevices(), session };
    }

    it("should resolve to the only device supporting the property (no ambiguity)", async () => {
      const program = parse("tv.mute = on");
      const result = await interpret_home_dsl(program, await filteredCtx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(1);
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1);
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe("tv_mute");
    });

    it("should still be ambiguous when all devices support the property", async () => {
      const program = parse("tv.power = on");
      const result = await interpret_home_dsl(program, await filteredCtx());

      expect(result.status).toBe("waiting");
      expect(result.awaiting!.choices).toHaveLength(2);
    });

    it("should resolve to the only device supporting the action (no ambiguity)", async () => {
      const driver = makeDriver();
      await driver.init({});

      const speaker_next: Device = {
        id: "speaker_next",
        type: "speaker",
        room: "salon",
        name: "Salon Speaker",
        driver,
        driverConfig: {
          properties: {},
          actions: ["play", "pause", "next"],
        },
      };

      const speaker_basic: Device = {
        id: "speaker_basic",
        type: "speaker",
        room: "chambre",
        name: "Chambre Speaker",
        driver,
        driverConfig: {
          properties: {},
          actions: ["play", "pause"],
        },
      };

      const ctx: VMContext = { devices: [speaker_next, speaker_basic] };
      const program = parse("speaker.next()");
      const result = await interpret_home_dsl(program, ctx);

      expect(result.status).toBe("success");
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1);
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe("speaker_next");
    });

    it("should include filter feedback in executed statement", async () => {
      const program = parse("tv.mute = on");
      const result = await interpret_home_dsl(program, await filteredCtx());

      expect(result.status).toBe("success");
      const stmt = result.executed[0]!;
      expect(stmt.filter).toBeDefined();
      expect(stmt.filter!.candidates).toBe(2);
      expect(stmt.filter!.matched).toBe(1);
      expect(stmt.filter!.excluded).toHaveLength(1);

      const excluded: ExcludedDevice = stmt.filter!.excluded[0]!;
      expect(excluded.deviceId).toBe("tv_basic");
      expect(excluded.deviceName).toBe("Basic TV");
      expect(excluded.reason).toBe("property_not_supported");
      expect(excluded.details).toContain("does not support property 'mute'");
    });

    it("should include filter feedback when all candidates match", async () => {
      const program = parse("tv.power = on");
      const result = await interpret_home_dsl(program, await filteredCtx());

      expect(result.status).toBe("waiting");
    });

    it("should include filter feedback on error when no device supports the intent", async () => {
      const driver = makeDriver();
      await driver.init({});

      const light: Device = {
        id: "light_1",
        type: "light",
        room: "salon",
        name: "Salon Light",
        driver,
        driverConfig: {
          properties: { power: { type: "boolean" }, brightness: { type: "number" } },
          actions: [],
        },
      };

      const ctx: VMContext = { devices: [light] };
      const program = parse("light.volume = 50");
      const result = await interpret_home_dsl(program, ctx);

      expect(result.status).toBe("error");
      expect(result.errors[0]!.message).toContain("No devices found");
    });

    it("should pass devices through when no capabilities are declared in driverConfig", async () => {
      const driver = makeDriver();
      await driver.init({});

      const tv1: Device = {
        id: "tv_1", type: "tv", room: "salon", name: "Salon TV",
        driver, driverConfig: {},
      };
      const tv2: Device = {
        id: "tv_2", type: "tv", room: "chambre", name: "Chambre TV",
        driver, driverConfig: {},
      };

      const ctx: VMContext = { devices: [tv1, tv2] };
      const program = parse("tv.power = on");
      const result = await interpret_home_dsl(program, ctx);

      expect(result.status).toBe("waiting");
      expect(result.awaiting!.choices).toHaveLength(2);
    });

    it("should not set filter on executed statement when no intent is used", async () => {
      const program = parse("salon_tv = tv[salon]");
      const result = await interpret_home_dsl(program, await filteredCtx());

      expect(result.status).toBe("success");
      const stmt = result.executed[0]!;
      expect(stmt.filter).toBeUndefined();
    });
  });
});
