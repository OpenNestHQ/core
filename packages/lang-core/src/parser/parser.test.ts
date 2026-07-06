import { describe, it, expect } from "vitest";
import { parseHomeDSL, ParseError } from "./parser.js";
import type { Assignment, Segment } from "../ast/types.js";

function assignment(path: Segment[], value: Parameters<typeof makeAssignmentValue>[0]): Assignment {
  return { kind: "assignment", path, value: makeAssignmentValue(value) };
}

function makeAssignmentValue(v: number | "on" | "off" | string | { kind: string; value: string }) {
  if (typeof v === "number") return { kind: "number" as const, value: v };
  if (v === "on" || v === "off") return { kind: "power" as const, value: v };
  if (typeof v === "object") return v;
  return { kind: "identifier" as const, value: v };
}

function seg(identifier: string, room?: string): Segment {
  if (room === "*") return { identifier, roomSelector: { kind: "wildcard" } };
  if (room) return { identifier, roomSelector: { kind: "room", name: room } };
  return { identifier, roomSelector: null };
}

function result(statements: unknown[]) {
  return { program: { kind: "program", statements }, errors: [] };
}

function resultWithErrors(statements: unknown[], errorCount: number) {
  return {
    program: { kind: "program", statements },
    errors: expect.arrayContaining(new Array(errorCount).fill(expect.objectContaining({ message: expect.any(String), line: expect.any(Number), column: expect.any(Number) }))),
  };
}

describe("parseHomeDSL", () => {
  describe("state assignments", () => {
    it("should parse tv.power = on", () => {
      expect(parseHomeDSL("tv.power = on")).toEqual(result([assignment([seg("tv"), seg("power")], "on")]));
    });

    it("should parse tv.power = off", () => {
      expect(parseHomeDSL("tv.power = off")).toEqual(result([assignment([seg("tv"), seg("power")], "off")]));
    });

    it("should parse with room selector", () => {
      expect(parseHomeDSL("tv[salon].power = on")).toEqual(result([assignment([seg("tv", "salon"), seg("power")], "on")]));
    });

    it("should parse light[chambre].brightness = 50", () => {
      expect(parseHomeDSL("light[chambre].brightness = 50")).toEqual(result([assignment([seg("light", "chambre"), seg("brightness")], 50)]));
    });

    it("should parse wildcard room selector", () => {
      expect(parseHomeDSL("light[*].power = off")).toEqual(result([assignment([seg("light", "*"), seg("power")], "off")]));
    });

    it("should parse thermostat.temperature = 21", () => {
      expect(parseHomeDSL("thermostat.temperature = 21")).toEqual(result([assignment([seg("thermostat"), seg("temperature")], 21)]));
    });

    it("should parse identifier value", () => {
      expect(parseHomeDSL("tv.source = hdmi1")).toEqual(result([assignment([seg("tv"), seg("source")], "hdmi1")]));
    });

    it("should parse enum value with underscores", () => {
      expect(parseHomeDSL("tv.source = salle_de_bain")).toEqual(result([assignment([seg("tv"), seg("source")], "salle_de_bain")]));
    });

    it("should parse fan.speed = 2", () => {
      expect(parseHomeDSL("fan.speed = 2")).toEqual(result([assignment([seg("fan"), seg("speed")], 2)]));
    });

    it("should parse blind.position = 100", () => {
      expect(parseHomeDSL("blind.position = 100")).toEqual(result([assignment([seg("blind"), seg("position")], 100)]));
    });

    it("should parse switch.power = on", () => {
      expect(parseHomeDSL("switch.power = on")).toEqual(result([assignment([seg("switch"), seg("power")], "on")]));
    });
  });

  describe("context reference (it)", () => {
    it("should parse it.power = off", () => {
      expect(parseHomeDSL("it.power = off")).toEqual(result([assignment([seg("it"), seg("power")], "off")]));
    });

    it("should parse it.volume = 20", () => {
      expect(parseHomeDSL("it.volume = 20")).toEqual(result([assignment([seg("it"), seg("volume")], 20)]));
    });

    it("should parse it with room selector and action", () => {
      expect(parseHomeDSL("it[salon].power = on")).toEqual(result([assignment([seg("it", "salon"), seg("power")], "on")]));
    });
  });

  describe("queries", () => {
    it("should parse tv.power?", () => {
      expect(parseHomeDSL("tv.power?")).toEqual(result([{ kind: "query", path: [seg("tv"), seg("power")] }]));
    });

    it("should parse thermostat.temperature?", () => {
      expect(parseHomeDSL("thermostat.temperature?")).toEqual(result([{ kind: "query", path: [seg("thermostat"), seg("temperature")] }]));
    });

    it("should parse query with room selector", () => {
      expect(parseHomeDSL("tv[salon].power?")).toEqual(result([{ kind: "query", path: [seg("tv", "salon"), seg("power")] }]));
    });
  });

  describe("increments", () => {
    it("should parse speaker.volume += 10", () => {
      expect(parseHomeDSL("speaker.volume += 10")).toEqual(result([{
        kind: "increment",
        path: [seg("speaker"), seg("volume")],
        value: { kind: "number", value: 10 },
      }]));
    });

    it("should parse it.volume += 5", () => {
      expect(parseHomeDSL("it.volume += 5")).toEqual(result([{
        kind: "increment",
        path: [seg("it"), seg("volume")],
        value: { kind: "number", value: 5 },
      }]));
    });

    it("should parse thermostat.temperature += 2", () => {
      expect(parseHomeDSL("thermostat.temperature += 2")).toEqual(result([{
        kind: "increment",
        path: [seg("thermostat"), seg("temperature")],
        value: { kind: "number", value: 2 },
      }]));
    });
  });

  describe("actions", () => {
    it("should parse vacuum.start()", () => {
      expect(parseHomeDSL("vacuum.start()")).toEqual(result([{ kind: "action", path: [seg("vacuum"), seg("start")] }]));
    });

    it("should parse camera.snapshot()", () => {
      expect(parseHomeDSL("camera.snapshot()")).toEqual(result([{ kind: "action", path: [seg("camera"), seg("snapshot")] }]));
    });

    it("should parse door.lock()", () => {
      expect(parseHomeDSL("door.lock()")).toEqual(result([{ kind: "action", path: [seg("door"), seg("lock")] }]));
    });

    it("should parse door.unlock()", () => {
      expect(parseHomeDSL("door.unlock()")).toEqual(result([{ kind: "action", path: [seg("door"), seg("unlock")] }]));
    });

    it("should parse speaker.play()", () => {
      expect(parseHomeDSL("speaker.play()")).toEqual(result([{ kind: "action", path: [seg("speaker"), seg("play")] }]));
    });

    it("should parse speaker.pause()", () => {
      expect(parseHomeDSL("speaker.pause()")).toEqual(result([{ kind: "action", path: [seg("speaker"), seg("pause")] }]));
    });

    it("should parse speaker.next()", () => {
      expect(parseHomeDSL("speaker.next()")).toEqual(result([{ kind: "action", path: [seg("speaker"), seg("next")] }]));
    });

    it("should parse action with room selector", () => {
      expect(parseHomeDSL("tv[salon].play()")).toEqual(result([{ kind: "action", path: [seg("tv", "salon"), seg("play")] }]));
    });

    it("should parse it.play()", () => {
      expect(parseHomeDSL("it.play()")).toEqual(result([{ kind: "action", path: [seg("it"), seg("play")] }]));
    });
  });

  describe("variable assignments", () => {
    it("should parse living_tv = tv[salon]", () => {
      expect(parseHomeDSL("living_tv = tv[salon]")).toEqual(result([{
        kind: "variable_assignment",
        name: "living_tv",
        value: {
          kind: "device_ref",
          deviceType: "tv",
          roomSelector: { kind: "room", name: "salon" },
        },
      }]));
    });

    it("should parse lights = @all(light[salon])", () => {
      expect(parseHomeDSL("lights = @all(light[salon])")).toEqual(result([{
        kind: "variable_assignment",
        name: "lights",
        value: {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "light",
            roomSelector: { kind: "room", name: "salon" },
          },
        },
      }]));
    });

    it("should parse tvs = @all(tv[salon])", () => {
      expect(parseHomeDSL("tvs = @all(tv[salon])")).toEqual(result([{
        kind: "variable_assignment",
        name: "tvs",
        value: {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "tv",
            roomSelector: { kind: "room", name: "salon" },
          },
        },
      }]));
    });

    it("should parse @first collection", () => {
      expect(parseHomeDSL("first_light = @first(light[chambre])")).toEqual(result([{
        kind: "variable_assignment",
        name: "first_light",
        value: {
          kind: "collection",
          modifier: "@first",
          device: {
            deviceType: "light",
            roomSelector: { kind: "room", name: "chambre" },
          },
        },
      }]));
    });

    it("should parse collection with wildcard", () => {
      expect(parseHomeDSL("all_lights = @all(light[*])")).toEqual(result([{
        kind: "variable_assignment",
        name: "all_lights",
        value: {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "light",
            roomSelector: { kind: "wildcard" },
          },
        },
      }]));
    });

    it("should parse device ref without room", () => {
      expect(parseHomeDSL("my_tv = tv")).toEqual(result([{
        kind: "variable_assignment",
        name: "my_tv",
        value: {
          kind: "device_ref",
          deviceType: "tv",
          roomSelector: null,
        },
      }]));
    });

    it("should parse variable assigned to power value", () => {
      expect(parseHomeDSL("state = on")).toEqual(result([{
        kind: "variable_assignment",
        name: "state",
        value: { kind: "power", value: "on" },
      }]));
    });

    it("should parse variable assigned to number", () => {
      expect(parseHomeDSL("target_temp = 22")).toEqual(result([{
        kind: "variable_assignment",
        name: "target_temp",
        value: { kind: "number", value: 22 },
      }]));
    });

    it("should parse variable assigned to string", () => {
      expect(parseHomeDSL('label = "living room"')).toEqual(result([{
        kind: "variable_assignment",
        name: "label",
        value: { kind: "string", value: "living room" },
      }]));
    });
  });

  describe("multi-line programs", () => {
    it("should parse program from README example", () => {
      const r = parseHomeDSL("lights = @all(light[salon])\nlights.power = on");
      expect(r.program.kind).toBe("program");
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[0]!.kind).toBe("variable_assignment");
      expect(r.program.statements[1]!.kind).toBe("assignment");
    });

    it("should parse program from prompt example", () => {
      const r = parseHomeDSL("tv.power = on\nit.volume = 20");
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[0]!.kind).toBe("assignment");
      expect(r.program.statements[1]!.kind).toBe("assignment");
    });

    it("should handle empty lines between statements", () => {
      const r = parseHomeDSL("tv.power = on\n\nit.volume = 20\n\nspeaker.play()");
      expect(r.program.statements).toHaveLength(3);
      expect(r.program.statements[0]!.kind).toBe("assignment");
      expect(r.program.statements[1]!.kind).toBe("assignment");
      expect(r.program.statements[2]!.kind).toBe("action");
    });

    it("should handle multiple consecutive empty lines", () => {
      const r = parseHomeDSL("\n\n\n\ntv.power = on\n\n\n\n");
      expect(r.program.statements).toHaveLength(1);
    });

    it("should parse empty input", () => {
      expect(parseHomeDSL("")).toEqual({ program: { kind: "program", statements: [] }, errors: [] });
    });

    it("should parse whitespace-only input", () => {
      expect(parseHomeDSL("   \n  \n   ")).toEqual({ program: { kind: "program", statements: [] }, errors: [] });
    });
  });

  describe("whitespace handling", () => {
    it("should trim leading whitespace", () => {
      expect(parseHomeDSL("   tv.power = on").program.statements).toHaveLength(1);
    });

    it("should trim trailing whitespace", () => {
      expect(parseHomeDSL("tv.power = on   ").program.statements).toHaveLength(1);
    });

    it("should handle spaces around =", () => {
      const r = parseHomeDSL("tv.power  =  on");
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("assignment");
    });

    it("should handle spaces around +=", () => {
      const r = parseHomeDSL("speaker.volume   +=   10");
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("increment");
    });

    it("should handle spaces around parentheses in action", () => {
      const r = parseHomeDSL("vacuum.start  (  )");
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("action");
    });

    it("should handle spaces around ?", () => {
      const r = parseHomeDSL("tv.power  ?");
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("query");
    });

    it("should handle spaces in collection expression", () => {
      const r = parseHomeDSL("x = @all(  light[salon]  )");
      expect(r.program.statements).toHaveLength(1);
      const stmt = r.program.statements[0]!;
      expect(stmt.kind).toBe("variable_assignment");
      if (stmt.kind === "variable_assignment") {
        expect(stmt.value.kind).toBe("collection");
      }
    });
  });

  describe("sub-property paths", () => {
    it("should parse three-segment path for nested property", () => {
      const r = parseHomeDSL("nightstand.light.power = on");
      expect(r.program.statements).toHaveLength(1);
      const stmt = r.program.statements[0]!;
      expect(stmt.kind).toBe("assignment");
      if (stmt.kind === "assignment") {
        expect(stmt.path).toHaveLength(3);
        expect(stmt.path[0]!.identifier).toBe("nightstand");
        expect(stmt.path[1]!.identifier).toBe("light");
        expect(stmt.path[2]!.identifier).toBe("power");
      }
    });

    it("should parse deep sub-property path", () => {
      const r = parseHomeDSL("a.b.c.d.e = 42");
      expect(r.program.statements).toHaveLength(1);
      const stmt = r.program.statements[0]!;
      expect(stmt.kind).toBe("assignment");
      if (stmt.kind === "assignment") {
        expect(stmt.path).toHaveLength(5);
        expect(stmt.path[4]!.identifier).toBe("e");
      }
    });
  });

  describe("error recovery", () => {
    it("should record error on invalid input and continue", () => {
      const r = parseHomeDSL("???");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/Unrecognized/);
      expect(r.errors[0]!.line).toBe(1);
      expect(r.program.statements).toHaveLength(0);
    });

    it("should record error on missing value in assignment", () => {
      const r = parseHomeDSL("tv.power =");
      expect(r.errors).toHaveLength(1);
    });

    it("should record error on invalid path separator", () => {
      const r = parseHomeDSL("tv->power = on");
      expect(r.errors).toHaveLength(1);
    });

    it("should record error on unbalanced brackets", () => {
      const r = parseHomeDSL("tv[salon.power = on");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/Invalid path segment/);
    });

    it("should record error on action with arguments", () => {
      const r = parseHomeDSL("vacuum.start(5)");
      expect(r.errors).toHaveLength(1);
    });

    it("should record error on stale line", () => {
      const r = parseHomeDSL("just some words");
      expect(r.errors).toHaveLength(1);
    });

    it("should include correct line number in each error", () => {
      const r = parseHomeDSL("tv.power = on\n???\ncamera.snapshot()");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.line).toBe(2);
      expect(r.program.statements).toHaveLength(2);
    });

    it("should include column number in errors", () => {
      const r = parseHomeDSL("tv.power = on\n@@@\ncamera.snapshot()");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.column).toBeGreaterThan(0);
      expect(r.program.statements).toHaveLength(2);
    });

    it("should record error on invalid device ref in expression", () => {
      const r = parseHomeDSL("x = tv[[salon]]");
      expect(r.errors).toHaveLength(1);
    });

    it("should continue parsing valid lines after errors", () => {
      const r = parseHomeDSL("tv.power = on\nbad line\nspeaker.play()\n~~~\nlight[*].power = off");
      expect(r.errors).toHaveLength(2);
      expect(r.program.statements).toHaveLength(3);
      expect(r.program.statements[0]!.kind).toBe("assignment");
      expect(r.program.statements[1]!.kind).toBe("action");
      expect(r.program.statements[2]!.kind).toBe("assignment");
    });

    it("should return empty errors array for valid input", () => {
      const r = parseHomeDSL("tv.power = on\nspeaker.play()");
      expect(r.errors).toHaveLength(0);
    });

    it("should handle mixed valid and invalid with empty lines", () => {
      const r = parseHomeDSL("tv.power = on\n\nbad\n\nspeaker.play()");
      expect(r.errors).toHaveLength(1);
      expect(r.program.statements).toHaveLength(2);
    });
  });

  describe("program structure", () => {
    it("should wrap result with parse result structure", () => {
      const r = parseHomeDSL("tv.power = on");
      expect(r).toHaveProperty("program");
      expect(r).toHaveProperty("errors");
      expect(r.program.kind).toBe("program");
    });

    it("should have statements array", () => {
      const r = parseHomeDSL("tv.power = on");
      expect(Array.isArray(r.program.statements)).toBe(true);
    });

    it("should provide statements in order", () => {
      const r = parseHomeDSL("tv.power = on\nspeaker.play()\nthermostat.temperature?");
      expect(r.program.statements).toHaveLength(3);
      expect(r.program.statements[0]!.kind).toBe("assignment");
      expect(r.program.statements[1]!.kind).toBe("action");
      expect(r.program.statements[2]!.kind).toBe("query");
    });
  });
});
