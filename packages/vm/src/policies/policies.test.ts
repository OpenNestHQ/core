import { describe, it, expect, vi } from "vitest";
import { parseHomeDSL } from "@opennest/lang-core";
import { MockDriver } from "@opennest/devices";
import { interpret_home_dsl, createSession } from "../index.js";
import { runPolicyPipeline } from "../policies/pipeline.js";
import { NoopExecutionPolicy } from "../policies/noop.js";
import type {
  Device,
  VMContext,
  Session,
  ExecutionPolicy,
  PolicyContext,
  PolicyDecision,
  PlannedAction,
  PipelineOutcome,
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
    makeDevice("tv_salon", "tv", "salon", "Salon TV", { power: false, volume: 15 }),
    makeDevice("tv_chambre", "tv", "chambre", "Chambre TV", { power: false, volume: 10 }),
    makeDevice("light_salon", "light", "salon", "Salon Light", { power: false, brightness: 80 }),
    makeDevice("vacuum_salon", "vacuum", "salon", "Salon Vacuum", {}),
  ];
}

async function ctx(session?: Session, policies?: ExecutionPolicy[]): Promise<VMContext> {
  return { devices: await devices(), session, policies };
}

function parse(code: string) {
  const result = parseHomeDSL(code);
  if (result.errors.length > 0) {
    throw new Error(`Parse errors: ${result.errors.map((e) => e.message).join(", ")}`);
  }
  return result.program;
}

function makeAction(overrides?: Partial<PlannedAction>): PlannedAction {
  const base: PlannedAction = {
    kind: "set_property",
    device: makeDevice("d", "light", "room", "Test", {}),
    property: "power",
    value: { kind: "power" as const, value: "on" },
  };
  return { ...base, ...overrides } as PlannedAction;
}

// ──── Pipeline unit tests ────

describe("runPolicyPipeline", () => {
  const session = createSession();

  it("empty policies → execute with original action", async () => {
    const action = makeAction();
    const result = await runPolicyPipeline(action, [], { session, devices: [] });

    expect(result.kind).toBe("execute");
    if (result.kind === "execute") {
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toBe(action);
    }
  });

  it("noop policy only → execute with original action", async () => {
    const action = makeAction();
    const result = await runPolicyPipeline(action, [new NoopExecutionPolicy()], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
    if (result.kind === "execute") {
      expect(result.actions[0]).toBe(action);
    }
  });

  it("multiple noop policies → all pass, execute", async () => {
    const action = makeAction();
    const result = await runPolicyPipeline(
      action,
      [new NoopExecutionPolicy(), new NoopExecutionPolicy(), new NoopExecutionPolicy()],
      { session, devices: [] },
    );

    expect(result.kind).toBe("execute");
  });

  it("block → blocked outcome with policy name", async () => {
    const blockPolicy: ExecutionPolicy = {
      name: "blocker",
      evaluate: () => ({ kind: "block", reason: "not allowed" }),
    };

    const result = await runPolicyPipeline(makeAction(), [blockPolicy], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.policyName).toBe("blocker");
      expect(result.reason).toBe("not allowed");
    }
  });

  it("skip → skipped outcome", async () => {
    const skipPolicy: ExecutionPolicy = {
      name: "skipper",
      evaluate: () => ({ kind: "skip", reason: "irrelevant" }),
    };

    const result = await runPolicyPipeline(makeAction(), [skipPolicy], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("skipped");
  });

  it("pause → paused outcome with interaction", async () => {
    const pausePolicy: ExecutionPolicy = {
      name: "pauser",
      evaluate: () => ({
        kind: "pause",
        interaction: {
          id: "test-1",
          type: "confirmation",
          message: "Are you sure?",
        },
        context: { actionId: "42" },
      }),
    };

    const result = await runPolicyPipeline(makeAction(), [pausePolicy], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("paused");
    if (result.kind === "paused") {
      expect(result.interaction.type).toBe("confirmation");
      expect(result.context).toEqual({ actionId: "42" });
    }
  });

  it("policy order matters — first blocking wins", async () => {
    const blockFirst: ExecutionPolicy = {
      name: "blocker",
      evaluate: () => ({ kind: "block", reason: "no" }),
    };
    const neverCalled: ExecutionPolicy = {
      name: "never",
      evaluate: vi.fn(() => ({ kind: "continue" })),
    };

    const result = await runPolicyPipeline(makeAction(), [blockFirst, neverCalled], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("blocked");
    expect(neverCalled.evaluate).not.toHaveBeenCalled();
  });

  it("replace → next policies see replaced action", async () => {
    const replacedAction = makeAction({ kind: "read_property" as const, property: "brightness" });
    const replacer: ExecutionPolicy = {
      name: "replacer",
      evaluate: () => ({ kind: "replace", action: replacedAction }),
    };
    const verifier: ExecutionPolicy = {
      name: "verifier",
      evaluate: (ctx: PolicyContext) => {
        expect(ctx.action.kind).toBe("read_property");
        return { kind: "continue" };
      },
    };

    const result = await runPolicyPipeline(makeAction(), [replacer, verifier], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
    if (result.kind === "execute") {
      expect(result.actions[0]!.kind).toBe("read_property");
    }
  });

  it("expand → flattened execute", async () => {
    const exp1 = makeAction({ kind: "set_property" as const, property: "p1" });
    const exp2 = makeAction({ kind: "set_property" as const, property: "p2" });
    const expander: ExecutionPolicy = {
      name: "expander",
      evaluate: () => ({ kind: "expand", actions: [exp1, exp2] }),
    };

    const result = await runPolicyPipeline(makeAction(), [expander], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
    if (result.kind === "execute") {
      expect(result.actions).toHaveLength(2);
      if (result.actions[0]!.kind === "set_property") {
        expect(result.actions[0]!.property).toBe("p1");
      }
      if (result.actions[1]!.kind === "set_property") {
        expect(result.actions[1]!.property).toBe("p2");
      }
    }
  });

  it("async policy evaluation", async () => {
    const asyncPolicy: ExecutionPolicy = {
      name: "async",
      evaluate: async () => {
        await Promise.resolve();
        return { kind: "continue" };
      },
    };

    const result = await runPolicyPipeline(makeAction(), [asyncPolicy], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
  });
});

// ──── VM integration tests ────

describe("VM with execution policies", () => {
  it("VM with NoopExecutionPolicy behaves identically to VM without policies", async () => {
    const program = parse("tv[salon].power = on");
    const noPolicies = await ctx();
    const withNoop = await ctx(undefined, [new NoopExecutionPolicy()]);

    const resultNoPolicies = await interpret_home_dsl(program, noPolicies);
    const resultWithNoop = await interpret_home_dsl(program, withNoop);

    expect(resultWithNoop.status).toBe("success");
    expect(resultWithNoop.executed).toHaveLength(1);
    expect(resultWithNoop.executed[0]!.changes).toHaveLength(1);
    expect(resultWithNoop.executed[0]!.changes[0]!.property).toBe("power");
    expect(resultWithNoop.executed[0]!.changes[0]!.newValue).toBe(true);
    expect(resultWithNoop.executed[0]!.resolvedDevices).toHaveLength(1);
    expect(resultWithNoop.executed[0]!.resolvedDevices[0]!.id).toBe("tv_salon");

    expect(resultWithNoop.status).toBe(resultNoPolicies.status);
    expect(resultWithNoop.executed.length).toBe(resultNoPolicies.executed.length);
  });

  it("blocking policy → VM returns error", async () => {
    const blocker: ExecutionPolicy = {
      name: "safety_blocker",
      evaluate: () => ({ kind: "block", reason: "safety check failed" }),
    };

    const program = parse("tv[salon].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [blocker]));

    expect(result.status).toBe("error");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("safety_blocker");
    expect(result.errors[0]!.message).toContain("safety check failed");
  });

  it("skipping policy → action not executed", async () => {
    const skipper: ExecutionPolicy = {
      name: "skipper",
      evaluate: () => ({ kind: "skip" }),
    };

    const program = parse("tv[salon].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [skipper]));

    expect(result.status).toBe("success");
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0]!.changes).toHaveLength(0);
  });

  it("pausing policy → VM returns awaiting_interaction", async () => {
    const pauser: ExecutionPolicy = {
      name: "pauser",
      evaluate: () => ({
        kind: "pause",
        interaction: {
          id: "confirm-1",
          type: "confirmation",
          message: "Proceed?",
        },
      }),
    };

    const program = parse("tv[salon].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [pauser]));

    expect(result.status).toBe("awaiting_interaction");
    expect(result.interaction).not.toBeNull();
    expect(result.interaction!.type).toBe("confirmation");
  });

  it("policy receives session context", async () => {
    const session = createSession();
    const spy = vi.fn(() => ({ kind: "continue" as const }));

    const inspectorPolicy: ExecutionPolicy = {
      name: "inspector",
      evaluate: spy,
    };

    const program = parse("tv[salon].power = on");
    await interpret_home_dsl(program, await ctx(session, [inspectorPolicy]));

    expect(spy).toHaveBeenCalled();
    const ctxArg: PolicyContext = spy.mock.calls[0]![0]!;
    expect(ctxArg.action.kind).toBe("set_property");
    expect(ctxArg.session).toBe(session);
  });

  it("policy receives proper action kind for each DSL statement type", async () => {
    const spy = vi.fn(() => ({ kind: "continue" as const }));
    const inspector: ExecutionPolicy = { name: "inspector", evaluate: spy };

    const context = await ctx(undefined, [inspector]);

    await interpret_home_dsl(parse("tv[salon].power = on"), context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("set_property");
    spy.mockClear();

    await interpret_home_dsl(parse("tv[salon].power?"), context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("read_property");
    spy.mockClear();

    await interpret_home_dsl(parse("tv[salon].volume += 10"), context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("increment_property");
    spy.mockClear();

    await interpret_home_dsl(parse("vacuum[salon].start()"), context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("invoke_action");
  });

  it("skip one device in a batch → other devices still execute", async () => {
    const skipTvChambre: ExecutionPolicy = {
      name: "skip_chambre",
      evaluate: (ctx: PolicyContext) => {
        if (ctx.action.device.id === "tv_chambre") {
          return { kind: "skip" as const, reason: "skip chambre tv" };
        }
        return { kind: "continue" as const };
      },
    };

    const program = parse("tv[*].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [skipTvChambre]));

    expect(result.status).toBe("success");
    expect(result.executed).toHaveLength(1);
    const exec = result.executed[0]!;
    expect(exec.changes).toHaveLength(1);
    expect(exec.changes[0]!.deviceId).toBe("tv_salon");
    expect(exec.resolvedDevices).toHaveLength(1);
    expect(exec.resolvedDevices[0]!.id).toBe("tv_salon");
  });

  it("block one device in a batch → whole statement fails", async () => {
    const blockTvChambre: ExecutionPolicy = {
      name: "blocker",
      evaluate: (ctx: PolicyContext) => {
        if (ctx.action.device.id === "tv_chambre") {
          return { kind: "block" as const, reason: "not safe" };
        }
        return { kind: "continue" as const };
      },
    };

    const program = parse("tv[*].power = on");
    const result = await interpret_home_dsl(program, await ctx(undefined, [blockTvChambre]));

    expect(result.status).toBe("error");
  });
});
