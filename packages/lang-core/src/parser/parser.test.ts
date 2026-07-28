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

function seg(identifier: string, room?: string, isVariable?: boolean): Segment {
  const base = room === "*"
    ? { identifier, selectors: [{ kind: "wildcard" as const }] }
    : room
      ? { identifier, selectors: [{ kind: "room" as const, name: room }] }
      : { identifier, selectors: [] as const };
  return isVariable ? { ...base, isVariable: true } : base;
}

function vseg(identifier: string): Segment {
  return { identifier, selectors: [], isVariable: true };
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
      expect(parseHomeDSL("tv[living_room].power = on")).toEqual(result([assignment([seg("tv", "living_room"), seg("power")], "on")]));
    });

    it("should parse light[bedroom].brightness = 50", () => {
      expect(parseHomeDSL("light[bedroom].brightness = 50")).toEqual(result([assignment([seg("light", "bedroom"), seg("brightness")], 50)]));
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

  describe("context reference ($it)", () => {
    it("should parse $it.power = off", () => {
      expect(parseHomeDSL("$it.power = off")).toEqual(result([assignment([vseg("it"), seg("power")], "off")]));
    });

    it("should parse $it.volume = 20", () => {
      expect(parseHomeDSL("$it.volume = 20")).toEqual(result([assignment([vseg("it"), seg("volume")], 20)]));
    });

    it("should reject room selector on $it", () => {
      const r = parseHomeDSL("$it[living_room].power = on");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/room selector/);
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
      expect(parseHomeDSL("tv[living_room].power?")).toEqual(result([{ kind: "query", path: [seg("tv", "living_room"), seg("power")] }]));
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

    it("should parse $it.volume += 5", () => {
      expect(parseHomeDSL("$it.volume += 5")).toEqual(result([{
        kind: "increment",
        path: [vseg("it"), seg("volume")],
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
      expect(parseHomeDSL("tv[living_room].play()")).toEqual(result([{ kind: "action", path: [seg("tv", "living_room"), seg("play")] }]));
    });

    it("should parse $it.play()", () => {
      expect(parseHomeDSL("$it.play()")).toEqual(result([{ kind: "action", path: [vseg("it"), seg("play")] }]));
    });
  });

  describe("variable assignments", () => {
    it("should parse $living_tv = tv[living_room]", () => {
      expect(parseHomeDSL("$living_tv = tv[living_room]")).toEqual(result([{
        kind: "variable_assignment",
        name: "living_tv",
        value: {
          kind: "device_ref",
          deviceType: "tv",
          selectors: [{ kind: "room", name: "living_room" }],
        },
      }]));
    });

    it("should parse $lights = @all(light[living_room])", () => {
      expect(parseHomeDSL("$lights = @all(light[living_room])")).toEqual(result([{
        kind: "variable_assignment",
        name: "lights",
        value: {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "light",
            selectors: [{ kind: "room", name: "living_room" }],
          },
        },
      }]));
    });

    it("should parse $tvs = @all(tv[living_room])", () => {
      expect(parseHomeDSL("$tvs = @all(tv[living_room])")).toEqual(result([{
        kind: "variable_assignment",
        name: "tvs",
        value: {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "tv",
            selectors: [{ kind: "room", name: "living_room" }],
          },
        },
      }]));
    });

    it("should parse @first collection", () => {
      expect(parseHomeDSL("$first_light = @first(light[bedroom])")).toEqual(result([{
        kind: "variable_assignment",
        name: "first_light",
        value: {
          kind: "collection",
          modifier: "@first",
          device: {
            deviceType: "light",
            selectors: [{ kind: "room", name: "bedroom" }],
          },
        },
      }]));
    });

    it("should parse @oneof collection", () => {
      expect(parseHomeDSL("$my_tv = @oneof(tv[living_room])")).toEqual(result([{
        kind: "variable_assignment",
        name: "my_tv",
        value: {
          kind: "collection",
          modifier: "@oneof",
          device: {
            deviceType: "tv",
            selectors: [{ kind: "room", name: "living_room" }],
          },
        },
      }]));
    });

    it("should parse @oneof without room selector", () => {
      expect(parseHomeDSL("$main_light = @oneof(light)")).toEqual(result([{
        kind: "variable_assignment",
        name: "main_light",
        value: {
          kind: "collection",
          modifier: "@oneof",
          device: {
            deviceType: "light",
            selectors: [],
          },
        },
      }]));
    });

    it("should parse @oneof with wildcard", () => {
      expect(parseHomeDSL("$any_tv = @oneof(tv[*])")).toEqual(result([{
        kind: "variable_assignment",
        name: "any_tv",
        value: {
          kind: "collection",
          modifier: "@oneof",
          device: {
            deviceType: "tv",
            selectors: [{ kind: "wildcard" }],
          },
        },
      }]));
    });

    it("should parse collection with wildcard", () => {
      expect(parseHomeDSL("$all_lights = @all(light[*])")).toEqual(result([{
        kind: "variable_assignment",
        name: "all_lights",
        value: {
          kind: "collection",
          modifier: "@all",
          device: {
            deviceType: "light",
            selectors: [{ kind: "wildcard" }],
          },
        },
      }]));
    });

    it("should parse device ref without room", () => {
      expect(parseHomeDSL("$my_tv = tv")).toEqual(result([{
        kind: "variable_assignment",
        name: "my_tv",
        value: {
          kind: "device_ref",
          deviceType: "tv",
          selectors: [],
        },
      }]));
    });

    it("should parse variable assigned to power value", () => {
      expect(parseHomeDSL("$state = on")).toEqual(result([{
        kind: "variable_assignment",
        name: "state",
        value: { kind: "power", value: "on" },
      }]));
    });

    it("should parse variable assigned to number", () => {
      expect(parseHomeDSL("$target_temp = 22")).toEqual(result([{
        kind: "variable_assignment",
        name: "target_temp",
        value: { kind: "number", value: 22 },
      }]));
    });

    it("should parse variable assigned to string", () => {
      expect(parseHomeDSL('$label = "living room"')).toEqual(result([{
        kind: "variable_assignment",
        name: "label",
        value: { kind: "string", value: "living room" },
      }]));
    });
  });

  describe("variable references in paths", () => {
    it("should parse $tv.power = on as assignment with isVariable", () => {
      expect(parseHomeDSL("$tv.power = on")).toEqual(result([assignment([vseg("tv"), seg("power")], "on")]));
    });

    it("should parse $tv.volume += 10 as increment with isVariable", () => {
      expect(parseHomeDSL("$tv.volume += 10")).toEqual(result([{
        kind: "increment",
        path: [vseg("tv"), seg("volume")],
        value: { kind: "number", value: 10 },
      }]));
    });

    it("should parse $tv.volume? as query with isVariable", () => {
      expect(parseHomeDSL("$tv.volume?")).toEqual(result([{
        kind: "query",
        path: [vseg("tv"), seg("volume")],
      }]));
    });

    it("should parse $tv.play() as action with isVariable", () => {
      expect(parseHomeDSL("$tv.play()")).toEqual(result([{
        kind: "action",
        path: [vseg("tv"), seg("play")],
      }]));
    });

    it("should parse $salon_tv.power = off", () => {
      expect(parseHomeDSL("$salon_tv.power = off")).toEqual(result([assignment([vseg("salon_tv"), seg("power")], "off")]));
    });
  });

  describe("variable name validation", () => {
    it("should reject room selector on variable reference", () => {
      const r = parseHomeDSL("$tv[living_room].power = on");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/Variable references cannot have a room selector/);
    });

    it("should reject room selector on variable in action", () => {
      const r = parseHomeDSL("$tv[living_room].play()");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/Variable references cannot have a room selector/);
    });

    it("should reject $it as variable name", () => {
      const r = parseHomeDSL("$it = tv[living_room]");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/reserved/);
    });

    it("should suggest $ when variable name is missing $", () => {
      const r = parseHomeDSL("tv = tv[living_room]");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/\$/);
    });

    it("should suggest $ for old-style variable name", () => {
      const r = parseHomeDSL("lights = @all(light[living_room])");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/\$/);
    });

    it("should reject variable name with special chars after $", () => {
      const r = parseHomeDSL("$123abc = tv[living_room]");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/Invalid variable name/);
    });

    it("should reject empty variable name after $", () => {
      const r = parseHomeDSL("$ = tv[living_room]");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/Invalid variable name/);
    });

    it("should parse variable with underscore and digits", () => {
      expect(parseHomeDSL("$tv_42 = tv[living_room]")).toEqual(result([{
        kind: "variable_assignment",
        name: "tv_42",
        value: {
          kind: "device_ref",
          deviceType: "tv",
          selectors: [{ kind: "room", name: "living_room" }],
        },
      }]));
    });
  });

  describe("multi-line programs", () => {
    it("should parse program from README example", () => {
      const r = parseHomeDSL("$lights = @all(light[living_room])\n$lights.power = on");
      expect(r.program.kind).toBe("program");
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[0]!.kind).toBe("variable_assignment");
      expect(r.program.statements[1]!.kind).toBe("assignment");
    });

    it("should parse program from prompt example", () => {
      const r = parseHomeDSL("tv.power = on\n$it.volume = 20");
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[0]!.kind).toBe("assignment");
      expect(r.program.statements[1]!.kind).toBe("assignment");
    });

    it("should handle empty lines between statements", () => {
      const r = parseHomeDSL("tv.power = on\n\n$it.volume = 20\n\nspeaker.play()");
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
      const r = parseHomeDSL("$x = @all(  light[living_room]  )");
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
      const r = parseHomeDSL("$x = tv[[living_room]]");
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

  describe("conditional blocks (@if)", () => {
    it("should parse @if with string value", () => {
      const r = parseHomeDSL(`@if $light.power? == "on"\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("if");
    });

    it("should parse @if with != operator", () => {
      const r = parseHomeDSL(`@if $light.power? != off\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements[0]!.kind).toBe("if");
    });

    it("should parse @if with numeric comparison", () => {
      const r = parseHomeDSL(`@if $thermostat.temperature? == 21\nfan.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements[0]!.kind).toBe("if");
    });

    it("should parse @if with power value", () => {
      const r = parseHomeDSL(`@if $tv.power? == on\ntv.volume = 10\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements[0]!.kind).toBe("if");
    });

    it("should parse @if with @else", () => {
      const r = parseHomeDSL(`@if $light.power? == on\nlight.power = off\n@else\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(1);
      const stmt = r.program.statements[0]!;
      expect(stmt.kind).toBe("if");
      if (stmt.kind === "if") {
        expect(stmt.body).toHaveLength(1);
        expect(stmt.elseBody).toBeDefined();
        expect(stmt.elseBody).toHaveLength(1);
      }
    });

    it("should parse @if with variable in condition", () => {
      const r = parseHomeDSL(`$light_salon = light[living_room]\n@if $light_salon.power? == on\nlight[kitchen].power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[0]!.kind).toBe("variable_assignment");
      expect(r.program.statements[1]!.kind).toBe("if");
    });

    it("should parse nested @if blocks", () => {
      const r = parseHomeDSL(`@if $tv.power? == on\n@if $light.power? == on\nspeaker.power = off\n@endif\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("if");
      if (r.program.statements[0]!.kind === "if") {
        expect(r.program.statements[0]!.body).toHaveLength(1);
        expect(r.program.statements[0]!.body[0]!.kind).toBe("if");
      }
    });

    it("should parse nested @if with @else", () => {
      const r = parseHomeDSL(`@if $outer.power? == on\n@if $inner.power? == on\nlight.power = on\n@else\nlight.power = off\n@endif\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(1);
    });

    it("should parse multiple @if blocks at same level", () => {
      const r = parseHomeDSL(`@if $light.power? == on\nspeaker.power = on\n@endif\n@if $tv.power? == on\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[0]!.kind).toBe("if");
      expect(r.program.statements[1]!.kind).toBe("if");
    });

    it("should parse @if with empty body", () => {
      const r = parseHomeDSL(`@if $light.power? == on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("if");
      if (r.program.statements[0]!.kind === "if") {
        expect(r.program.statements[0]!.body).toHaveLength(0);
      }
    });

    it("should parse @if with empty body and @else", () => {
      const r = parseHomeDSL(`@if $light.power? == on\n@else\nspeaker.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(1);
      if (r.program.statements[0]!.kind === "if") {
        expect(r.program.statements[0]!.body).toHaveLength(0);
        expect(r.program.statements[0]!.elseBody).toHaveLength(1);
      }
    });

    it("should parse @if with $it in condition", () => {
      const r = parseHomeDSL(`@if $it.power? == on\nlight.power = off\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements[0]!.kind).toBe("if");
    });

    it("should parse @if with room selector in condition", () => {
      const r = parseHomeDSL(`@if light[living_room].power? == on\nspeaker[living_room].power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements[0]!.kind).toBe("if");
    });

    it("should record error for @endif outside of @if", () => {
      const r = parseHomeDSL("@endif");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/outside/);
    });

    it("should record error for @else outside of @if", () => {
      const r = parseHomeDSL("@else");
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]!.message).toMatch(/outside/);
    });

    it("should record error for @if without condition", () => {
      const r = parseHomeDSL("@if\nlight.power = on\n@endif");
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("should record error for @if with invalid condition syntax", () => {
      const r = parseHomeDSL("@if something without proper syntax\nlight.power = on\n@endif");
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("should record error for missing @endif", () => {
      const r = parseHomeDSL("@if $light.power? == on\nlight.power = off");
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
      expect(r.errors[0]!.message).toMatch(/Missing @endif/);
    });

    it("should record error for missing @endif in nested @if", () => {
      const r = parseHomeDSL("@if $tv.power? == on\n@if $light.power? == on\nspeaker.power = off\n@endif");
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
    });

    it("should recover after invalid @if condition", () => {
      const r = parseHomeDSL("@if bad condition\n@endif\ntv.power = on");
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
      expect(r.program.statements).toHaveLength(1);
      expect(r.program.statements[0]!.kind).toBe("assignment");
    });

    it("should parse @if after a regular statement", () => {
      const r = parseHomeDSL(`$tv = tv[living_room]\n@if $tv.power? == on\n$tv.volume = 20\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[0]!.kind).toBe("variable_assignment");
      expect(r.program.statements[1]!.kind).toBe("if");
    });

    it("should parse regular statements after @if block", () => {
      const r = parseHomeDSL(`@if $light.power? == on\nspeaker.power = on\n@endif\ntv.power = off`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(2);
      expect(r.program.statements[1]!.kind).toBe("assignment");
    });

    it("should handle @if condition with quoted string value", () => {
      const r = parseHomeDSL(`@if $tv.source? == "hdmi1"\ntv.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements[0]!.kind).toBe("if");
      if (r.program.statements[0]!.kind === "if") {
        expect(r.program.statements[0]!.condition.value.kind).toBe("string");
        if (r.program.statements[0]!.condition.value.kind === "string") {
          expect(r.program.statements[0]!.condition.value.value).toBe("hdmi1");
        }
      }
    });

    it("should parse @if condition with variable path segments", () => {
      const r = parseHomeDSL(`@if $light_salon.power? == on\nlight[kitchen].power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      const stmt = r.program.statements[0]!;
      if (stmt.kind === "if") {
        expect(stmt.condition.path[0]!.isVariable).toBe(true);
        expect(stmt.condition.path[0]!.identifier).toBe("light_salon");
        expect(stmt.condition.path[1]!.identifier).toBe("power");
        expect(stmt.condition.op).toBe("==");
        expect(stmt.condition.value.kind).toBe("power");
      }
    });
    it("should parse @if with compound & condition", () => {
      const r = parseHomeDSL(`@if $a.power? == on & $b.power? == off\nspeaker.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements).toHaveLength(1);
      const stmt = r.program.statements[0]!;
      if (stmt.kind === "if") {
        expect(stmt.condition.kind).toBe("compound_condition");
        if (stmt.condition.kind === "compound_condition") {
          expect(stmt.condition.operator).toBe("&");
          expect(stmt.condition.left.kind).toBe("condition");
          expect(stmt.condition.right.kind).toBe("condition");
        }
      }
    });

    it("should parse @if with compound | condition", () => {
      const r = parseHomeDSL(`@if $a.power? == on | $b.power? == off\nspeaker.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      const stmt = r.program.statements[0]!;
      if (stmt.kind === "if" && stmt.condition.kind === "compound_condition") {
        expect(stmt.condition.operator).toBe("|");
      }
    });

    it("should parse @if with three conditions joined by &", () => {
      const r = parseHomeDSL(`@if $a.power? == on & $b.power? == off & $c.power? == on\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
    });

    it("should parse @if with parentheses for grouping", () => {
      const r = parseHomeDSL(`@if ($a.power? == on | $b.power? == off) & $c.power? == on\nspeaker.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      const stmt = r.program.statements[0]!;
      if (stmt.kind === "if" && stmt.condition.kind === "compound_condition") {
        expect(stmt.condition.operator).toBe("&");
        expect(stmt.condition.left.kind).toBe("compound_condition");
      }
    });

    it("should give & higher precedence than |", () => {
      const r = parseHomeDSL(`@if a? == on & b? == off | c? == on\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      const stmt = r.program.statements[0]!;
      if (stmt.kind === "if" && stmt.condition.kind === "compound_condition") {
        expect(stmt.condition.operator).toBe("|");
        expect(stmt.condition.left.kind).toBe("compound_condition");
        if (stmt.condition.left.kind === "compound_condition") {
          expect(stmt.condition.left.operator).toBe("&");
        }
        expect(stmt.condition.right.kind).toBe("condition");
      }
    });

    it("should parse deeply nested parentheses", () => {
      const r = parseHomeDSL(`@if ((a? == on)) & b? == off\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
    });

    it("should parse @if with & and != operator", () => {
      const r = parseHomeDSL(`@if $a.power? != off & $b.power? == on\nlight.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
    });

    it("should parse @if with room selectors in compound condition", () => {
      const r = parseHomeDSL(`@if light[living_room].power? == on & tv[bedroom].power? == on\nspeaker.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
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

  describe("owner selectors", () => {
    it("should parse light[owner:Alice].power = on", () => {
      const r = parseHomeDSL("light[owner:Alice].power = on");
      expect(r.errors).toHaveLength(0);
      const stmt = r.program.statements[0]!;
      expect(stmt.kind).toBe("assignment");
      if (stmt.kind === "assignment") {
        expect(stmt.path[0]!.selectors).toEqual([{ kind: "owner", name: "Alice" }]);
      }
    });

    it("should parse chained room + owner selector", () => {
      const r = parseHomeDSL("light[salon][owner:Alice].power = on");
      expect(r.errors).toHaveLength(0);
      const stmt = r.program.statements[0]!;
      expect(stmt.kind).toBe("assignment");
      if (stmt.kind === "assignment") {
        expect(stmt.path[0]!.selectors).toEqual([
          { kind: "room", name: "salon" },
          { kind: "owner", name: "Alice" },
        ]);
      }
    });

    it("should parse collection with owner selector", () => {
      const r = parseHomeDSL("$alice = @all(light[owner:Alice])");
      expect(r.errors).toHaveLength(0);
      const stmt = r.program.statements[0]!;
      expect(stmt.kind).toBe("variable_assignment");
      if (stmt.kind === "variable_assignment" && stmt.value.kind === "collection") {
        expect(stmt.value.device.selectors).toEqual([{ kind: "owner", name: "Alice" }]);
      }
    });

    it("should parse owner selector in @if condition", () => {
      const r = parseHomeDSL(`@if light[owner:Alice].power? == on\nspeaker.power = on\n@endif`);
      expect(r.errors).toHaveLength(0);
      expect(r.program.statements[0]!.kind).toBe("if");
    });

    it("should reject invalid owner name", () => {
      const r = parseHomeDSL("light[owner:].power = on");
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});
