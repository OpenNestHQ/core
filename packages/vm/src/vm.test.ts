import { describe, it, expect } from "vitest";
import { parseHomeDSL } from "@opennest/lang-core";
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
  Assignment,
  Query,
  Increment,
  Action,
  VariableAssignment,
  Segment,
  PowerValue,
} from "./index.js";

function makeDevice(
  id: string,
  type: string,
  room: string,
  name: string,
  initialState: Record<string, unknown> = {},
): Device {
  return { id, type, room, name, state: { ...initialState } };
}

function devices(): Device[] {
  return [
    makeDevice("tv_salon", "tv", "salon", "Salon TV", {
      power: false,
      volume: 15,
    }),
    makeDevice("tv_chambre", "tv", "chambre", "Chambre TV", {
      power: false,
      volume: 10,
    }),
    makeDevice("light_salon_1", "light", "salon", "Salon Light 1", {
      power: false,
      brightness: 80,
    }),
    makeDevice("light_salon_2", "light", "salon", "Salon Light 2", {
      power: true,
      brightness: 60,
    }),
    makeDevice("thermostat_salon", "thermostat", "salon", "Salon Thermostat", {
      temperature: 21,
    }),
    makeDevice("vacuum_salon", "vacuum", "salon", "Salon Vacuum", {}),
    makeDevice("speaker_salon", "speaker", "salon", "Salon Speaker", {
      power: false,
      volume: 30,
    }),
  ];
}

function ctx(session?: Session): VMContext {
  return { devices: devices(), session };
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

describe("interpret_home_dsl", () => {
  describe("basic assignments", () => {
    it("should assign a property on an unambiguous device", () => {
      const program = parse("tv[salon].power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(1);
      const exec = result.executed[0]!;
      expect(exec.resolvedDevices).toHaveLength(1);
      expect(exec.resolvedDevices[0]!.id).toBe("tv_salon");
      expect(exec.changes[0]!.property).toBe("power");
      expect(exec.changes[0]!.newValue).toBe(true);
    });

    it("should assign a numeric value", () => {
      const program = parse("tv[salon].volume = 42");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe(42);
    });

    it("should assign a string value", () => {
      const program = parse(`tv[salon].source = "hdmi1"`);
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe("hdmi1");
    });

    it("should assign to a wildcard room selector (all rooms)", () => {
      const program = parse("tv[*].power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.resolvedDevices).toHaveLength(2);
      const ids = result.executed[0]!.resolvedDevices.map((d) => d.id);
      expect(ids).toContain("tv_salon");
      expect(ids).toContain("tv_chambre");
    });
  });

  describe("queries", () => {
    it("should query a device property", () => {
      const program = parse("thermostat[salon].temperature?");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe(21);
    });

    it("should query tv power", () => {
      const program = parse("tv[salon].power?");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.newValue).toBe(false);
    });
  });

  describe("increments", () => {
    it("should increment a numeric property", () => {
      const program = parse("tv[salon].volume += 5");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed[0]!.changes[0]!.oldValue).toBe(15);
      expect(result.executed[0]!.changes[0]!.newValue).toBe(20);
    });
  });

  describe("actions", () => {
    it("should execute an action on a device", () => {
      const program = parse("vacuum[salon].start()");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      const change = result.executed[0]!.changes[0]!;
      expect(change.property).toBe("action:start");
      expect(change.newValue).toBe("called");
    });
  });

  describe("variable assignments", () => {
    it("should store a variable reference", () => {
      const program = parse("salon_tv = tv[salon]");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.session.variables["salon_tv"]).toEqual({
        kind: "device_ref",
        deviceType: "tv",
        roomSelector: { kind: "room", name: "salon" },
      });
    });

    it("should use a variable to reference a device", () => {
      const program = parse(`salon_tv = tv[salon]\nsalon_tv.power = on`);
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);
      const assignmentResult = result.executed[1]!;
      expect(assignmentResult.resolvedDevices[0]!.id).toBe("tv_salon");
      expect(assignmentResult.changes[0]!.newValue).toBe(true);
    });

    it("should store a collection variable", () => {
      const program = parse("lights = @all(light[salon])");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.session.variables["lights"]).toEqual({
        kind: "device_ref",
        deviceType: "light",
        roomSelector: { kind: "room", name: "salon" },
      });
    });
  });

  describe("context reference (it)", () => {
    it("should use 'it' to reference the last resolved device", () => {
      const program = parse(`tv[salon].volume = 20\nit.power = on`);
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);

      const secondExecution = result.executed[1]!;
      expect(secondExecution.resolvedDevices[0]!.id).toBe("tv_salon");
      expect(secondExecution.changes[0]!.property).toBe("power");
      expect(secondExecution.changes[0]!.newValue).toBe(true);
    });

    it("should error when 'it' is used before any resolution", () => {
      const program = parse("it.power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("error");
    });

    it("should carry 'it' across sessions", () => {
      const program1 = parse("tv[salon].volume = 30");
      const result1 = interpret_home_dsl(program1, ctx());

      expect(result1.session.it?.id).toBe("tv_salon");

      const program2 = parse("it.power = on");
      const result2 = interpret_home_dsl(program2, ctx(result1.session));

      expect(result2.status).toBe("success");
      expect(result2.executed[0]!.resolvedDevices[0]!.id).toBe("tv_salon");
    });
  });

  describe("ambiguity handling", () => {
    it("should return waiting state when device type is ambiguous (no room)", () => {
      const program = parse("tv.power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("waiting");
      expect(result.awaiting).not.toBeNull();
      expect(result.awaiting!.kind).toBe("target");
      expect(result.awaiting!.choices).toHaveLength(2);

      const choiceLabels = result.awaiting!.choices.map((c) => c.label);
      expect(choiceLabels).toContain("Salon TV");
      expect(choiceLabels).toContain("Chambre TV");
    });

    it("should not be ambiguous when room is specified", () => {
      const program = parse("tv[salon].power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
    });

    it("should not be ambiguous for a single device type across rooms", () => {
      const program = parse("thermostat.power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).not.toBe("waiting");
    });

    it("should return waiting state with DSL choices", () => {
      const program = parse("tv.power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.awaiting!.choices[0]!.dsl).toContain("tv[");
    });
  });

  describe("multi-line programs", () => {
    it("should execute multiple statements in order", () => {
      const program = parse(
        `tv[salon].power = on\ntv[salon].volume = 25\nlight[salon].brightness = 50`,
      );
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(3);
    });

    it("should stop at the first ambiguous statement", () => {
      const program = parse(`tv[salon].power = on\ntv.power = on\nlight[salon].power = on`);
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("waiting");
      expect(result.executed).toHaveLength(1);
    });

    it("should execute all statements with explicit room selectors", () => {
      const program = parse(
        `tv[salon].power = on\nspeaker[salon].volume = 20`,
      );
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);
    });
  });

  describe("session persistence", () => {
    it("should track execution history", () => {
      const program = parse(
        `tv[salon].power = on\nlight[salon].brightness = 40`,
      );
      const result = interpret_home_dsl(program, ctx());

      expect(result.session.history).toHaveLength(2);
    });

    it("should persist variables across calls", () => {
      const program1 = parse("salon_tv = tv[salon]");
      const result1 = interpret_home_dsl(program1, ctx());

      const program2 = parse("salon_tv.volume = 50");
      const result2 = interpret_home_dsl(program2, ctx(result1.session));

      expect(result2.status).toBe("success");
      expect(result2.session.variables["salon_tv"]).toBeDefined();
      const lastExec = result2.executed[result2.executed.length - 1]!;
      expect(lastExec.resolvedDevices[0]!.id).toBe("tv_salon");
    });

    it("should accumulate history across calls", () => {
      const program1 = parse("tv[salon].power = on");
      const result1 = interpret_home_dsl(program1, ctx());

      const program2 = parse("light[salon].power = off");
      const result2 = interpret_home_dsl(program2, ctx(result1.session));

      expect(result2.session.history).toHaveLength(2);
    });
  });

  describe("error cases", () => {
    it("should error when no devices match the type", () => {
      const program = parse("camera[salon].snapshot()");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("error");
      expect(result.errors[0]!.message).toContain("No devices found");
    });

    it("should error when no devices match the room", () => {
      const program = parse("tv[cuisine].power = on");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("error");
    });
  });

  describe("executor module", () => {
    it("should mutate device state on assignment", () => {
      const device = makeDevice("test", "light", "test", "Test", { power: false });
      const change = executeAssignment(device, "power", on());

      expect(change.newValue).toBe(true);
      expect(device.state.power).toBe(true);
    });

    it("should read device state on query", () => {
      const device = makeDevice("test", "light", "test", "Test", { brightness: 50 });
      const change = executeQuery(device, "brightness");

      expect(change.newValue).toBe(50);
    });

    it("should record action execution", () => {
      const device = makeDevice("test", "vacuum", "test", "Test", {});
      const change = executeAction(device, "start");

      expect(change.property).toBe("action:start");
      expect(change.newValue).toBe("called");
    });
  });

  describe("resolver module", () => {
    it("should match device by type and room", () => {
      const result = resolveDevices(
        [seg("tv", "salon")],
        devices(),
        createSession(),
      );

      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]!.id).toBe("tv_salon");
      expect(result.ambiguous).toBe(false);
    });

    it("should match all devices of a type with wildcard", () => {
      const result = resolveDevices(
        [seg("light", "*")],
        devices(),
        createSession(),
      );

      expect(result.devices).toHaveLength(2);
      expect(result.ambiguous).toBe(false);
    });

    it("should detect ambiguity when no room selector on multi-instance type", () => {
      const result = resolveDevices(
        [seg("tv")],
        devices(),
        createSession(),
      );

      expect(result.ambiguous).toBe(true);
      expect(result.choices).toHaveLength(2);
      expect(result.choices[0]!.dsl).toBe("tv[salon]");
      expect(result.choices[1]!.dsl).toBe("tv[chambre]");
    });

    it("should not be ambiguous for a type with a single instance", () => {
      const result = resolveDevices(
        [seg("thermostat")],
        devices(),
        createSession(),
      );

      expect(result.ambiguous).toBe(false);
      expect(result.devices).toHaveLength(1);
    });

    it("should resolve variables", () => {
      const session = createSession();
      session.variables["salon_tv"] = {
        kind: "device_ref",
        deviceType: "tv",
        roomSelector: { kind: "room", name: "salon" },
      };

      const result = resolveDevices(
        [seg("salon_tv"), seg("power")],
        devices(),
        session,
      );

      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]!.id).toBe("tv_salon");
    });

    it("should resolve 'it' context reference", () => {
      const session = createSession();
      session.it = devices().find((d) => d.id === "tv_salon")!;

      const result = resolveDevices(
        [seg("it"), seg("power")],
        devices(),
        session,
      );

      expect(result.devices).toHaveLength(1);
      expect(result.devices[0]!.id).toBe("tv_salon");
    });

    it("should return empty when 'it' is not set", () => {
      const result = resolveDevices(
        [seg("it"), seg("power")],
        devices(),
        createSession(),
      );

      expect(result.devices).toHaveLength(0);
    });
  });

  describe("collection expansion", () => {
    it("should expand @all for a collection", () => {
      const result = expandCollection(
        {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "light",
            roomSelector: { kind: "room", name: "salon" },
          },
        },
        devices(),
        createSession(),
      );

      expect(result.devices).toHaveLength(2);
    });

    it("should expand @first for a collection", () => {
      const result = expandCollection(
        {
          kind: "collection",
          modifier: "@first",
          device: {
            deviceType: "light",
            roomSelector: { kind: "room", name: "salon" },
          },
        },
        devices(),
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
    it("should turn on all lights in the living room", () => {
      const program = parse(`lights = @all(light[salon])\nlights.power = on`);
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);

      const assignExec = result.executed[1]!;
      expect(assignExec.resolvedDevices).toHaveLength(2);
      assignExec.resolvedDevices.forEach((d) => {
        expect(d.state.power).toBe(true);
      });
    });

    it("should assign tv power and volume in sequence", () => {
      const program = parse(`tv[salon].power = on\nit.volume = 20`);
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(2);

      const tv = result.executed[0]!.resolvedDevices[0]!;
      expect(tv.state.power).toBe(true);
      expect(tv.state.volume).toBe(20);
    });

    it("should handle 'turn off all lights'", () => {
      const program = parse(`light[*].power = off`);
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(1);
      expect(result.executed[0]!.resolvedDevices).toHaveLength(2);

      result.executed[0]!.resolvedDevices.forEach((d) => {
        expect(d.state.power).toBe(false);
      });
    });
  });

  describe("edge cases", () => {
    it("should handle an empty program", () => {
      const program = parse("");
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(0);
    });

    it("should handle multiple assignments to the same device", () => {
      const program = parse(
        `tv[salon].power = on\ntv[salon].volume = 50\ntv[salon].power = off`,
      );
      const result = interpret_home_dsl(program, ctx());

      expect(result.status).toBe("success");
      expect(result.executed).toHaveLength(3);

      const tv = result.executed[0]!.resolvedDevices[0]!;
      expect(tv.state.power).toBe(false);
      expect(tv.state.volume).toBe(50);
    });

    it("should preserve initial session state when passed", () => {
      const session = createSession();
      session.variables["foo"] = {
        kind: "device_ref",
        deviceType: "tv",
        roomSelector: { kind: "room", name: "salon" },
      };

      const program = parse("light[salon].power = on");
      const result = interpret_home_dsl(program, ctx(session));

      expect(result.session.variables["foo"]).toBeDefined();
      expect(result.session.variables["foo"]!.deviceType).toBe("tv");
    });
  });
});
