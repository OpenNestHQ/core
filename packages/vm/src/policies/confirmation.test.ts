import { describe, it, expect } from "vitest";
import { parseHomeDSL } from "@opennest/lang-core";
import { MockDriver } from "@opennest/devices";
import {
  interpret_home_dsl,
  createSession,
  resumeWithResponse,
  ConfirmationPolicy,
} from "../index.js";
import type {
  Device,
  VMContext,
  Session,
} from "../index.js";

function makeDevice(
  id: string,
  type: string,
  room: string,
  name: string,
  initialState: Record<string, unknown> = {},
): Device {
  const driver = new MockDriver();
  driver.seed(id, initialState);
  return { id, type, room, name, driver, driverConfig: {} };
}

async function devices(): Promise<Device[]> {
  return [
    makeDevice("tv_salon", "tv", "salon", "Salon TV", { power: false }),
    makeDevice("light_salon", "light", "salon", "Salon Light", { power: false }),
    makeDevice("thermostat_salon", "thermostat", "salon", "Salon Thermostat", { temperature: 21 }),
  ];
}

async function ctx(
  session?: Session,
  policies?: ConfirmationPolicy[],
): Promise<VMContext> {
  return { devices: await devices(), session, policies };
}

function parse(code: string) {
  const result = parseHomeDSL(code);
  if (result.errors.length > 0) {
    throw new Error(`Parse errors: ${result.errors.map((e) => e.message).join(", ")}`);
  }
  return result.program;
}

describe("ConfirmationPolicy", () => {
  it("does not pause when predicate returns false", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: () => false,
    });

    const program = parse("tv[salon].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [policy]));

    expect(result.status).toBe("success");
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0]!.changes).toHaveLength(1);
  });

  it("pauses when predicate returns true", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: () => true,
    });

    const program = parse("tv[salon].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [policy]));

    expect(result.status).toBe("awaiting_interaction");
    expect(result.interaction).not.toBeNull();
    expect(result.interaction!.type).toBe("confirmation");
    expect(result.interaction!.message).toContain("Salon TV");
  });

  it("pauses only on matching device types", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: (action) => action.device.type === "thermostat",
    });

    const tvProgram = parse("tv[salon].power = on");
    const tvResult = await interpret_home_dsl(tvProgram, await ctx(undefined, [policy]));
    expect(tvResult.status).toBe("success");

    const thermoProgram = parse("thermostat[salon].temperature = 22");
    const thermoResult = await interpret_home_dsl(thermoProgram, await ctx(undefined, [policy]));
    expect(thermoResult.status).toBe("awaiting_interaction");
  });

  it("resumes and executes when confirmed", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: () => true,
    });
    const session = createSession();
    const program = parse("tv[salon].power = on");

    const firstResult = await interpret_home_dsl(program, await ctx(session, [policy]));
    expect(firstResult.status).toBe("awaiting_interaction");

    resumeWithResponse(session, {
      interactionId: firstResult.interaction!.id,
      type: "confirmation",
      confirmed: true,
    });

    const secondResult = await interpret_home_dsl(program, await ctx(session, [policy]));
    expect(secondResult.status).toBe("success");
    expect(secondResult.executed).toHaveLength(1);
    expect(secondResult.executed[0]!.changes[0]!.newValue).toBe(true);
  });

  it("resumes and blocks when denied", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: () => true,
    });
    const session = createSession();
    const program = parse("tv[salon].power = on");

    const firstResult = await interpret_home_dsl(program, await ctx(session, [policy]));
    expect(firstResult.status).toBe("awaiting_interaction");

    resumeWithResponse(session, {
      interactionId: firstResult.interaction!.id,
      type: "confirmation",
      confirmed: false,
    });

    const secondResult = await interpret_home_dsl(program, await ctx(session, [policy]));
    expect(secondResult.status).toBe("error");
    expect(secondResult.errors[0]!.message).toContain("denied by user");
  });

  it("does not re-ask for an already confirmed action", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: () => true,
    });
    const session = createSession();
    const program = parse("tv[salon].power = on");

    const first = await interpret_home_dsl(program, await ctx(session, [policy]));
    resumeWithResponse(session, {
      interactionId: first.interaction!.id,
      type: "confirmation",
      confirmed: true,
    });

    const second = await interpret_home_dsl(program, await ctx(session, [policy]));
    expect(second.status).toBe("success");

    const third = await interpret_home_dsl(program, await ctx(session, [policy]));
    expect(third.status).toBe("success");
  });

  it("confirms each distinct action independently", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: () => true,
    });
    const session = createSession();

    const programTv = parse("tv[salon].power = on");
    const r1 = await interpret_home_dsl(programTv, await ctx(session, [policy]));
    expect(r1.status).toBe("awaiting_interaction");
    resumeWithResponse(session, {
      interactionId: r1.interaction!.id,
      type: "confirmation",
      confirmed: true,
    });

    const programLight = parse("light[salon].power = on");
    const r2 = await interpret_home_dsl(programLight, await ctx(session, [policy]));
    expect(r2.status).toBe("awaiting_interaction");
    expect(r2.interaction!.id).not.toBe(r1.interaction!.id);
  });

  it("uses custom message formatter", async () => {
    const policy = new ConfirmationPolicy({
      requireConfirmation: () => true,
      message: (action) => `[CUSTOM] Allow ${action.device.name}?`,
    });

    const program = parse("tv[salon].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [policy]));

    expect(result.interaction!.message).toContain("[CUSTOM]");
    expect(result.interaction!.message).toContain("Salon TV");
  });
});
