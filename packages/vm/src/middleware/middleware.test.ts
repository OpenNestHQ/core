import { describe, it, expect, vi } from "vitest";
import { parseHomeDSL } from "@opennest/lang-core";
import { MockDriver } from "@opennest/devices";
import { executeCommand, createSession } from "../index.js";
import { runMiddlewarePipeline } from "../middleware/pipeline.js";
import { noopMiddleware } from "../middleware/noop.js";
import { BlockSignal, SkipSignal, PauseSignal, ExpandSignal } from "../middleware/types.js";
import type {
  Device,
  VMContext,
  Session,
  Middleware,
  MiddlewareContext,
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

async function ctx(session?: Session, middleware?: Middleware[]): Promise<VMContext> {
  return { devices: await devices(), session, middleware };
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

describe("runMiddlewarePipeline", () => {
  const session = createSession();

  it("empty middleware → execute with original action", async () => {
    const action = makeAction();
    const result = await runMiddlewarePipeline(action, [], { session, devices: [] });

    expect(result.kind).toBe("execute");
    if (result.kind === "execute") {
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toBe(action);
    }
  });

  it("noop middleware only → execute with original action", async () => {
    const action = makeAction();
    const result = await runMiddlewarePipeline(action, [noopMiddleware], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
    if (result.kind === "execute") {
      expect(result.actions[0]).toBe(action);
    }
  });

  it("multiple noop middleware → all pass, execute", async () => {
    const action = makeAction();
    const result = await runMiddlewarePipeline(
      action,
      [noopMiddleware, noopMiddleware, noopMiddleware],
      { session, devices: [] },
    );

    expect(result.kind).toBe("execute");
  });

  it("block → blocked outcome", async () => {
    const blockMw: Middleware = async () => {
      throw new BlockSignal("not allowed");
    };

    const result = await runMiddlewarePipeline(makeAction(), [blockMw], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.reason).toBe("not allowed");
    }
  });

  it("skip → skipped outcome", async () => {
    const skipMw: Middleware = async () => {
      throw new SkipSignal("irrelevant");
    };

    const result = await runMiddlewarePipeline(makeAction(), [skipMw], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("skipped");
  });

  it("pause → paused outcome with interaction", async () => {
    const pauseMw: Middleware = async () => {
      throw new PauseSignal(
        {
          id: "test-1",
          type: "confirmation",
          message: "Are you sure?",
        },
        { actionId: "42" },
      );
    };

    const result = await runMiddlewarePipeline(makeAction(), [pauseMw], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("paused");
    if (result.kind === "paused") {
      expect(result.interaction.type).toBe("confirmation");
      expect(result.context).toEqual({ actionId: "42" });
    }
  });

  it("middleware order matters — first blocking wins", async () => {
    const blockFirst: Middleware = async () => {
      throw new BlockSignal("no");
    };
    const neverCalled = vi.fn(async (ctx: MiddlewareContext, next) => next());

    const result = await runMiddlewarePipeline(makeAction(), [blockFirst, neverCalled], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("blocked");
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("replace → next middleware see replaced action (via ctx mutation)", async () => {
    const replacedAction = makeAction({ kind: "read_property" as const, property: "brightness" });
    const replacer: Middleware = async (ctx, next) => {
      ctx.action = replacedAction;
      return next();
    };
    const verifier: Middleware = async (ctx, next) => {
      expect(ctx.action.kind).toBe("read_property");
      return next();
    };

    const result = await runMiddlewarePipeline(makeAction(), [replacer, verifier], {
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
    const expander: Middleware = async () => {
      throw new ExpandSignal([exp1, exp2]);
    };

    const result = await runMiddlewarePipeline(makeAction(), [expander], {
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

  it("async middleware evaluation — await next()", async () => {
    const asyncMw: Middleware = async (ctx, next) => {
      await Promise.resolve();
      return next();
    };

    const result = await runMiddlewarePipeline(makeAction(), [asyncMw], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
  });

  it("middleware can short-circuit without calling next()", async () => {
    const shortCircuitMw: Middleware = async () => {
      return { kind: "execute", actions: [] };
    };
    const neverCalled = vi.fn(async (ctx: MiddlewareContext, next) => next());

    const result = await runMiddlewarePipeline(makeAction(), [shortCircuitMw, neverCalled], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("middleware can wrap next() for pre/post hooks", async () => {
    const before: string[] = [];

    const wrapMw: Middleware = async (ctx, next) => {
      before.push("pre");
      const result = await next();
      before.push("post");
      return result;
    };

    const result = await runMiddlewarePipeline(makeAction(), [wrapMw], {
      session,
      devices: [],
    });

    expect(result.kind).toBe("execute");
    expect(before).toEqual(["pre", "post"]);
  });
});

// ──── VM integration tests ────

describe("VM with middleware", () => {
  it("VM with noopMiddleware behaves identically to VM without middleware", async () => {
    const program = parse("tv[salon].power = on");
    const noMiddleware = await ctx();
    const withNoop = await ctx(undefined, [noopMiddleware]);

    const resultNoMiddleware = await executeCommand({ kind: "run_program", program: program }, noMiddleware);
    const resultWithNoop = await executeCommand({ kind: "run_program", program: program }, withNoop);

    expect(resultWithNoop.status).toBe("success");
    expect(resultWithNoop.executed).toHaveLength(1);
    expect(resultWithNoop.executed[0]!.changes).toHaveLength(1);
    expect(resultWithNoop.executed[0]!.changes[0]!.property).toBe("power");
    expect(resultWithNoop.executed[0]!.changes[0]!.newValue).toBe(true);
    expect(resultWithNoop.executed[0]!.resolvedDevices).toHaveLength(1);
    expect(resultWithNoop.executed[0]!.resolvedDevices[0]!.id).toBe("tv_salon");

    expect(resultWithNoop.status).toBe(resultNoMiddleware.status);
    expect(resultWithNoop.executed.length).toBe(resultNoMiddleware.executed.length);
  });

  it("blocking middleware → VM returns error", async () => {
    const blocker: Middleware = async () => {
      throw new BlockSignal("safety check failed");
    };

    const program = parse("tv[salon].power = on");
    const result = await executeCommand({ kind: "run_program", program: program }, await ctx(undefined, [blocker]));

    expect(result.status).toBe("error");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("safety check failed");
  });

  it("skipping middleware → action not executed", async () => {
    const skipper: Middleware = async () => {
      throw new SkipSignal();
    };

    const program = parse("tv[salon].power = on");
    const result = await executeCommand({ kind: "run_program", program: program }, await ctx(undefined, [skipper]));

    expect(result.status).toBe("success");
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0]!.changes).toHaveLength(0);
  });

  it("pausing middleware → VM returns awaiting_interaction", async () => {
    const pauser: Middleware = async () => {
      throw new PauseSignal({
        id: "confirm-1",
        type: "confirmation",
        message: "Proceed?",
      });
    };

    const program = parse("tv[salon].power = on");
    const result = await executeCommand({ kind: "run_program", program: program }, await ctx(undefined, [pauser]));

    expect(result.status).toBe("awaiting_interaction");
    expect(result.interaction).not.toBeNull();
    expect(result.interaction!.type).toBe("confirmation");
  });

  it("middleware receives session context", async () => {
    const session = createSession();
    const spy = vi.fn(async (ctx: MiddlewareContext, next) => next());

    const inspectorMw: Middleware = spy;
    Object.defineProperty(inspectorMw, "name", { value: "inspector" });

    const program = parse("tv[salon].power = on");
    await executeCommand({ kind: "run_program", program: program }, await ctx(session, [inspectorMw]));

    expect(spy).toHaveBeenCalled();
    const ctxArg: MiddlewareContext = spy.mock.calls[0]![0]!;
    expect(ctxArg.action.kind).toBe("set_property");
    expect(ctxArg.session).toBe(session);
  });

  it("middleware receives proper action kind for each DSL statement type", async () => {
    const spy = vi.fn(async (ctx: MiddlewareContext, next) => next());
    const inspector: Middleware = spy;

    const context = await ctx(undefined, [inspector]);

    await executeCommand({ kind: "run_program", program: parse("tv[salon].power = on") }, context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("set_property");
    spy.mockClear();

    await executeCommand({ kind: "run_program", program: parse("tv[salon].power?") }, context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("read_property");
    spy.mockClear();

    await executeCommand({ kind: "run_program", program: parse("tv[salon].volume += 10") }, context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("increment_property");
    spy.mockClear();

    await executeCommand({ kind: "run_program", program: parse("vacuum[salon].start()") }, context);
    expect(spy.mock.calls[0]![0]!.action.kind).toBe("invoke_action");
  });

  it("skip one device in a batch → other devices still execute", async () => {
    const skipTvChambre: Middleware = async (ctx, next) => {
      if (ctx.action.device.id === "tv_chambre") {
        throw new SkipSignal("skip chambre tv");
      }
      return next();
    };

    const program = parse("tv[*].power = on");
    const result = await executeCommand({ kind: "run_program", program: program }, await ctx(undefined, [skipTvChambre]));

    expect(result.status).toBe("success");
    expect(result.executed).toHaveLength(1);
    const exec = result.executed[0]!;
    expect(exec.changes).toHaveLength(1);
    expect(exec.changes[0]!.deviceId).toBe("tv_salon");
    expect(exec.resolvedDevices).toHaveLength(1);
    expect(exec.resolvedDevices[0]!.id).toBe("tv_salon");
  });

  it("block one device in a batch → whole statement fails", async () => {
    const blockTvChambre: Middleware = async (ctx, next) => {
      if (ctx.action.device.id === "tv_chambre") {
        throw new BlockSignal("not safe");
      }
      return next();
    };

    const program = parse("tv[*].power = on");
    const result = await executeCommand({ kind: "run_program", program: program }, await ctx(undefined, [blockTvChambre]));

    expect(result.status).toBe("error");
  });
});
