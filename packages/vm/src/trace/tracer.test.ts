import { describe, it, expect } from "vitest";
import { parseHomeDSL } from "@opennest/lang-core";
import { MockDriver } from "@opennest/devices";
import {
  executeCommand,
  DefaultExecutionTracer,
  DefaultVMEventBus,
  NodeStatus,
  NodeKind,
  createConfirmationMiddleware,
} from "../index.js";
import type {
  Device,
} from "../index.js";

function parse(code: string) {
  const result = parseHomeDSL(code);
  if (result.errors.length > 0) {
    throw new Error(
      `Parse errors: ${result.errors.map((e: { message: string }) => e.message).join(", ")}`,
    );
  }
  return result.program;
}

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

// ---------------------------------------------------------------------------
// DefaultExecutionTracer
// ---------------------------------------------------------------------------
describe("DefaultExecutionTracer", () => {
  it("throws getTrace() when no events consumed", () => {
    const tracer = new DefaultExecutionTracer();
    expect(() => tracer.getTrace()).toThrow("No trace has been started");
  });

  it("builds a single Program node for program:begin/program:end", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });
    tracer.consume({
      kind: "program:end",
      timestamp: 1100,
      status: "success",
    });

    const trace = tracer.getTrace();
    const root = trace.root;

    expect(root.kind).toBe(NodeKind.Program);
    expect(root.name).toBe("program");
    expect(root.status).toBe(NodeStatus.Success);
    expect(root.startedAt).toBe(1000);
    expect(root.endedAt).toBe(1100);
    expect(root.duration).toBe(100);
    expect(root.children).toHaveLength(0);
    expect(root.parentId).toBeUndefined();
  });

  it("builds tree with Program > Statement hierarchy", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });

    tracer.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "assignment",
    });
    tracer.consume({
      kind: "statement:end",
      timestamp: 1020,
      status: "success",
      resolvedDeviceCount: 1,
      changeCount: 1,
    });

    tracer.consume({
      kind: "statement:begin",
      timestamp: 1030,
      index: 1,
      statementKind: "action",
    });
    tracer.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "success",
      resolvedDeviceCount: 1,
      changeCount: 1,
    });

    tracer.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "success",
    });

    const trace = tracer.getTrace();
    const root = trace.root;

    expect(root.children).toHaveLength(2);

    const s0 = root.children[0]!;
    expect(s0.kind).toBe(NodeKind.Statement);
    expect(s0.name).toBe("statement[0]");
    expect(s0.status).toBe(NodeStatus.Success);
    expect(s0.parentId).toBe(root.id);
    expect(s0.attributes).toMatchObject({
      statementKind: "assignment",
      resolvedDeviceCount: 1,
      changeCount: 1,
    });

    const s1 = root.children[1]!;
    expect(s1.kind).toBe(NodeKind.Statement);
    expect(s1.name).toBe("statement[1]");
    expect(s1.status).toBe(NodeStatus.Success);
    expect(s1.parentId).toBe(root.id);
    expect(s1.attributes).toMatchObject({
      statementKind: "action",
      resolvedDeviceCount: 1,
      changeCount: 1,
    });
  });

  it("handles failed statements", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });

    tracer.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "assignment",
    });
    tracer.consume({
      kind: "statement:end",
      timestamp: 1020,
      status: "failed",
      errors: [{ statement: {} as never, message: "No device found" }],
    });

    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "failed",
      errorCount: 1,
    });

    const trace = tracer.getTrace();
    const root = trace.root;

    expect(root.status).toBe(NodeStatus.Failed);
    expect(root.children[0]!.status).toBe(NodeStatus.Failed);
    expect(root.children[0]!.attributes.errors).toEqual(["No device found"]);
  });

  it("handles waiting status", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });

    tracer.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "assignment",
    });
    tracer.consume({
      kind: "statement:end",
      timestamp: 1020,
      status: "waiting",
    });

    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "waiting",
    });

    const trace = tracer.getTrace();
    const root = trace.root;

    expect(root.status).toBe(NodeStatus.Waiting);
    expect(root.children[0]!.status).toBe(NodeStatus.Waiting);
  });

  it("handles handler:begin/handler:end events", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });

    tracer.consume({
      kind: "handler:begin",
      timestamp: 1010,
      name: "device_selection",
    });
    tracer.consume({
      kind: "handler:end",
      timestamp: 1020,
      status: "waiting",
    });

    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "waiting",
    });

    const trace = tracer.getTrace();
    const handler = trace.root.children[0]!;
    expect(handler.kind).toBe(NodeKind.Handler);
    expect(handler.name).toBe("handler:device_selection");
    expect(handler.status).toBe(NodeStatus.Waiting);
    expect(handler.parentId).toBe(trace.root.id);
  });

  it("handles middleware:begin/middleware:end events", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });

    tracer.consume({
      kind: "middleware:begin",
      timestamp: 1010,
      name: "confirmation",
      actionKind: "set_property",
      deviceId: "tv_salon",
    });
    tracer.consume({
      kind: "middleware:end",
      timestamp: 1020,
      status: "success",
      decision: "execute",
    });

    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "success",
    });

    const trace = tracer.getTrace();
    const mwNode = trace.root.children[0]!;
    expect(mwNode.kind).toBe(NodeKind.Middleware);
    expect(mwNode.name).toBe("middleware:confirmation");
    expect(mwNode.status).toBe(NodeStatus.Success);
    expect(mwNode.attributes).toMatchObject({
      actionKind: "set_property",
      deviceId: "tv_salon",
      decision: "execute",
    });
  });

  it("handles middleware:end with skipped status", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });
    tracer.consume({
      kind: "middleware:begin",
      timestamp: 1010,
      name: "some_middleware",
      actionKind: "invoke_action",
      deviceId: "dev_1",
    });
    tracer.consume({
      kind: "middleware:end",
      timestamp: 1020,
      status: "skipped",
      decision: "skip",
    });
    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "success",
    });

    const trace = tracer.getTrace();
    const mwNode = trace.root.children[0]!;
    expect(mwNode.status).toBe(NodeStatus.Skipped);
    expect(mwNode.attributes.decision).toBe("skip");
  });

  it("handles middleware:end with block reason", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });
    tracer.consume({
      kind: "middleware:begin",
      timestamp: 1010,
      name: "guard",
      actionKind: "set_property",
      deviceId: "tv_1",
    });
    tracer.consume({
      kind: "middleware:end",
      timestamp: 1020,
      status: "failed",
      decision: "block",
      reason: "Not allowed",
    });
    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "failed",
    });

    const trace = tracer.getTrace();
    const mwNode = trace.root.children[0]!;
    expect(mwNode.status).toBe(NodeStatus.Failed);
    expect(mwNode.attributes.decision).toBe("block");
    expect(mwNode.attributes.reason).toBe("Not allowed");
  });

  it("handles action:begin/action:end events", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });

    tracer.consume({
      kind: "action:begin",
      timestamp: 1010,
      actionKind: "set_property",
      deviceId: "tv_salon",
      deviceName: "TV Salon",
      property: "power",
    });
    tracer.consume({
      kind: "action:end",
      timestamp: 1020,
      status: "success",
    });

    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "success",
    });

    const trace = tracer.getTrace();
    const node = trace.root.children[0]!;
    expect(node.kind).toBe(NodeKind.Execute);
    expect(node.name).toBe("execute:set_property");
    expect(node.status).toBe(NodeStatus.Success);
    expect(node.attributes).toMatchObject({
      deviceId: "tv_salon",
      deviceName: "TV Salon",
      property: "power",
    });
  });

  it("handles action:end with error", () => {
    const tracer = new DefaultExecutionTracer();

    tracer.consume({ kind: "program:begin", timestamp: 1000 });
    tracer.consume({
      kind: "action:begin",
      timestamp: 1010,
      actionKind: "invoke_action",
      deviceId: "vacuum_1",
      deviceName: "Vacuum",
      method: "start",
    });
    tracer.consume({
      kind: "action:end",
      timestamp: 1020,
      status: "failed",
      error: "Device unreachable",
    });
    tracer.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "failed",
    });

    const trace = tracer.getTrace();
    const node = trace.root.children[0]!;
    expect(node.status).toBe(NodeStatus.Failed);
    expect(node.attributes.error).toBe("Device unreachable");
    expect(node.attributes.method).toBe("start");
  });

  it("parallel traces are independent", () => {
    const t1 = new DefaultExecutionTracer();
    t1.consume({ kind: "program:begin", timestamp: 1000 });
    t1.consume({
      kind: "program:end",
      timestamp: 1100,
      status: "success",
    });

    const t2 = new DefaultExecutionTracer();
    t2.consume({ kind: "program:begin", timestamp: 2000 });
    t2.consume({
      kind: "program:end",
      timestamp: 2100,
      status: "success",
    });

    expect(t1.getTrace().root.startedAt).toBe(1000);
    expect(t2.getTrace().root.startedAt).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// DefaultVMEventBus
// ---------------------------------------------------------------------------
describe("DefaultVMEventBus", () => {
  it("creates bus without tracer", () => {
    const bus = new DefaultVMEventBus();
    expect(bus.tracer).toBeNull();
  });

  it("creates bus with tracer and routes events", () => {
    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    bus.emit({ kind: "program:begin", timestamp: 1000 });
    bus.emit({
      kind: "program:end",
      timestamp: 1100,
      status: "success",
    });

    const trace = tracer.getTrace();
    expect(trace.root.status).toBe(NodeStatus.Success);
  });

  it("supports multiple external subscribers", () => {
    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const events: string[] = [];
    const unsub = bus.subscribe((event) => events.push(event.kind));

    bus.emit({ kind: "program:begin", timestamp: 1000 });
    bus.emit({
      kind: "program:end",
      timestamp: 1100,
      status: "success",
    });

    expect(events).toEqual(["program:begin", "program:end"]);

    unsub();
    bus.emit({ kind: "program:begin", timestamp: 2000 });
    expect(events).toEqual(["program:begin", "program:end"]);
  });

  it("bus without tracer does not throw on emit", () => {
    const bus = new DefaultVMEventBus();
    expect(() =>
      bus.emit({ kind: "program:begin", timestamp: 1000 }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// VM integration
// ---------------------------------------------------------------------------
describe("VM with event bus", () => {
  it("produces trace for a successful two-statement program", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV Salon", driver, {
      power: false,
    });
    const light = await makeDevice(
      "light_salon",
      "light",
      "salon",
      "Light",
      driver,
      { power: false },
    );

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse(`
      tv[salon].power = on
      light[salon].power = on
    `);

    const result = await executeCommand(
      { kind: "run_program", program },
      { devices: [tv, light], eventBus: bus },
    );

    expect(result.status).toBe("success");

    const trace = tracer.getTrace();
    const root = trace.root;

    expect(root.kind).toBe(NodeKind.Program);
    expect(root.status).toBe(NodeStatus.Success);
    expect(root.children).toHaveLength(2);

    const s0 = root.children[0]!;
    expect(s0.kind).toBe(NodeKind.Statement);
    expect(s0.name).toBe("statement[0]");
    expect(s0.status).toBe(NodeStatus.Success);
    expect(s0.attributes.statementKind).toBe("assignment");
    expect(s0.attributes.resolvedDeviceCount).toBe(1);
    expect(s0.attributes.changeCount).toBe(1);
    expect(s0.duration).toBeGreaterThanOrEqual(0);

    const s1 = root.children[1]!;
    expect(s1.kind).toBe(NodeKind.Statement);
    expect(s1.name).toBe("statement[1]");
    expect(s1.status).toBe(NodeStatus.Success);
    expect(s1.attributes.statementKind).toBe("assignment");

    expect(tv.driver.getProperty("tv_salon", "power", {})).resolves.toBe(true);
  });

  it("no eventBus means no change in behavior", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV", driver, {
      power: false,
    });

    const program = parse("tv[salon].power = on");

    const result = await executeCommand(
      { kind: "run_program", program },
      { devices: [tv] },
    );

    expect(result.status).toBe("success");
    expect(result.executed).toHaveLength(1);
  });

  it("produces trace for a failed program (unknown device)", async () => {
    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse("unknown[salon].power = on");

    const result = await executeCommand(
      { kind: "run_program", program },
      { devices: [], eventBus: bus },
    );

    expect(result.status).toBe("error");

    const trace = tracer.getTrace();
    expect(trace.root.status).toBe(NodeStatus.Failed);
  });

  it("produces trace for awaiting_interaction (ambiguous)", async () => {
    const driver = makeDriver();
    const tv1 = await makeDevice("tv_1", "tv", "salon", "TV 1", driver, {
      power: false,
    });
    const tv2 = await makeDevice("tv_2", "tv", "salon", "TV 2", driver, {
      power: false,
    });

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse("tv[salon].power = on");

    const result = await executeCommand(
      { kind: "run_program", program },
      { devices: [tv1, tv2], eventBus: bus },
    );

    expect(result.status).toBe("awaiting_interaction");

    const trace = tracer.getTrace();
    expect(trace.root.status).toBe(NodeStatus.Waiting);
    expect(trace.root.children).toHaveLength(1);
    expect(trace.root.children[0]!.status).toBe(NodeStatus.Waiting);
    expect(trace.root.children[0]!.attributes.statementKind).toBe("assignment");
  });

  it("trace timestamps are monotonic within a program", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV", driver, {
      power: false,
    });
    const light = await makeDevice(
      "light_salon",
      "light",
      "salon",
      "Light",
      driver,
      { power: false },
    );

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse(`
      tv[salon].power = on
      light[salon].power = on
    `);

    await executeCommand(
      { kind: "run_program", program },
      { devices: [tv, light], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const root = trace.root;

    expect(root.startedAt).toBeLessThanOrEqual(root.endedAt!);

    const s0 = root.children[0]!;
    expect(root.startedAt).toBeLessThanOrEqual(s0.startedAt);
    expect(s0.startedAt).toBeLessThanOrEqual(s0.endedAt!);

    const s1 = root.children[1]!;
    expect(s0.endedAt!).toBeLessThanOrEqual(s1.startedAt);
    expect(s1.startedAt).toBeLessThanOrEqual(s1.endedAt!);

    expect(s1.endedAt!).toBeLessThanOrEqual(root.endedAt!);
  });

  it("multi-turn (manual resolve + rerun) creates independent traces", async () => {
    const driver = makeDriver();
    const tv1 = await makeDevice("tv_1", "tv", "salon", "TV 1", driver, {
      power: false,
    });
    const tv2 = await makeDevice("tv_2", "tv", "salon", "TV 2", driver, {
      power: false,
    });

    const tracer1 = new DefaultExecutionTracer();
    const bus1 = new DefaultVMEventBus(tracer1);

    const program = parse("tv[salon].power = on");

    const first = await executeCommand(
      { kind: "run_program", program },
      { devices: [tv1, tv2], eventBus: bus1 },
    );

    expect(first.status).toBe("awaiting_interaction");

    const trace1 = tracer1.getTrace();
    expect(trace1.root.status).toBe(NodeStatus.Waiting);

    first.session.resolvedIds["tv"] = "tv_1";

    const tracer2 = new DefaultExecutionTracer();
    const bus2 = new DefaultVMEventBus(tracer2);

    const second = await executeCommand(
      { kind: "run_program", program },
      { devices: [tv1, tv2], session: first.session, eventBus: bus2 },
    );

    expect(second.status).toBe("success");

    const trace2 = tracer2.getTrace();
    expect(trace2.root.status).toBe(NodeStatus.Success);
    expect(trace2.root.startedAt).toBeGreaterThanOrEqual(trace1.root.startedAt);
  });

  it("demonstrates the full trace shape from README example", async () => {
    const driver = makeDriver();
    const kitchen = await makeDevice(
      "kitchen_light",
      "light",
      "cuisine",
      "Kitchen Light",
      driver,
      { power: false },
    );
    const bedroom = await makeDevice(
      "bedroom_light",
      "light",
      "chambre",
      "Bedroom Light",
      driver,
      { power: false },
    );

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse(`
      light[cuisine].power = on
      light[chambre].power = off
    `);

    await executeCommand(
      { kind: "run_program", program },
      { devices: [kitchen, bedroom], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const root = trace.root;

    expect(root.kind).toBe(NodeKind.Program);
    expect(root.name).toBe("program");
    expect(root.status).toBe(NodeStatus.Success);
    expect(root.children).toHaveLength(2);

    const s0 = root.children[0]!;
    expect(s0.name).toBe("statement[0]");
    expect(s0.status).toBe(NodeStatus.Success);
    expect(s0.attributes.statementKind).toBe("assignment");
    expect(s0.attributes.resolvedDeviceCount).toBe(1);
    expect(s0.attributes.changeCount).toBe(1);
    expect(s0.duration).toBeGreaterThanOrEqual(0);

    const s1 = root.children[1]!;
    expect(s1.name).toBe("statement[1]");
    expect(s1.status).toBe(NodeStatus.Success);
    expect(s1.attributes.statementKind).toBe("assignment");
    expect(s1.attributes.resolvedDeviceCount).toBe(1);
    expect(s1.attributes.changeCount).toBe(1);
    expect(s1.duration).toBeGreaterThanOrEqual(0);
  });

  it("traces middleware evaluations when createConfirmationMiddleware is active", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV", driver, {
      power: false,
    });

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const mw = createConfirmationMiddleware({
      requireConfirmation: () => false,
    });

    const program = parse("tv[salon].power = on");

    await executeCommand(
      { kind: "run_program", program },
      { devices: [tv], middleware: [mw], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const stmt = trace.root.children[0]!;
    const mwNode = stmt.children.find((c) => c.kind === NodeKind.Middleware)!;
    expect(mwNode).toBeDefined();
    expect(mwNode.name).toBe("middleware:confirmation");
    expect(mwNode.status).toBe(NodeStatus.Success);
    expect(mwNode.attributes.decision).toBe("execute");
  });

  it("traces handler for device_selection ambiguity", async () => {
    const driver = makeDriver();
    const tv1 = await makeDevice("tv_1", "tv", "salon", "TV 1", driver, {
      power: false,
    });
    const tv2 = await makeDevice("tv_2", "tv", "salon", "TV 2", driver, {
      power: false,
    });

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse("tv[salon].power = on");

    await executeCommand(
      { kind: "run_program", program },
      { devices: [tv1, tv2], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const stmt = trace.root.children[0]!;
    expect(stmt.status).toBe(NodeStatus.Waiting);
    expect(stmt.children).toHaveLength(1);
    expect(stmt.children[0]!.kind).toBe(NodeKind.Handler);
    expect(stmt.children[0]!.name).toBe("handler:device_selection");
    expect(stmt.children[0]!.status).toBe(NodeStatus.Waiting);
  });

  it("traces middleware and handler when createConfirmationMiddleware pauses", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV", driver, {
      power: false,
    });

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const mw = createConfirmationMiddleware({
      requireConfirmation: () => true,
    });

    const program = parse("tv[salon].power = on");

    const result = await executeCommand(
      { kind: "run_program", program },
      { devices: [tv], middleware: [mw], eventBus: bus },
    );

    expect(result.status).toBe("awaiting_interaction");

    const trace = tracer.getTrace();
    const stmt = trace.root.children[0]!;
    expect(stmt.status).toBe(NodeStatus.Waiting);

    const mwNode = stmt.children.find((c) => c.kind === NodeKind.Middleware)!;
    expect(mwNode).toBeDefined();
    expect(mwNode.status).toBe(NodeStatus.Waiting);
    expect(mwNode.attributes.decision).toBe("pause");

    const handlerNode = stmt.children.find((c) => c.kind === NodeKind.Handler)!;
    expect(handlerNode).toBeDefined();
    expect(handlerNode.name).toBe("handler:confirmation");
    expect(handlerNode.status).toBe(NodeStatus.Waiting);
  });

  it("traces @if body statements as children of the if statement", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV", driver, {
      power: false,
    });
    const light = await makeDevice(
      "light_salon",
      "light",
      "salon",
      "Light",
      driver,
      { power: false },
    );

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse(`
      @if tv[salon].power? == off
        tv[salon].power = on
        light[salon].power = on
      @endif
    `);

    const result = await executeCommand(
      { kind: "run_program", program },
      { devices: [tv, light], eventBus: bus },
    );

    expect(result.status).toBe("success");

    const trace = tracer.getTrace();
    const stmt = trace.root.children[0]!;
    expect(stmt.kind).toBe(NodeKind.Statement);
    expect(stmt.attributes.statementKind).toBe("if");
    expect(stmt.status).toBe(NodeStatus.Success);

    expect(stmt.children).toHaveLength(2);
    expect(stmt.children[0]!.kind).toBe(NodeKind.Statement);
    expect(stmt.children[0]!.attributes.statementKind).toBe("assignment");
    expect(stmt.children[1]!.kind).toBe(NodeKind.Statement);
    expect(stmt.children[1]!.attributes.statementKind).toBe("assignment");
  });

  it("middleware events include deviceId and actionKind attributes", async () => {
    const driver = makeDriver();
    const vacuum = await makeDevice(
      "vacuum_salon",
      "vacuum",
      "salon",
      "Vacuum",
      driver,
      {},
    );

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const mw = createConfirmationMiddleware({
      requireConfirmation: () => false,
    });

    const program = parse("vacuum[salon].start()");

    await executeCommand(
      { kind: "run_program", program },
      { devices: [vacuum], middleware: [mw], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const mwNode = trace.root.children[0]!.children[0]!;
    expect(mwNode.attributes.actionKind).toBe("invoke_action");
    expect(mwNode.attributes.deviceId).toBe("vacuum_salon");
  });

  it("traces Execute nodes for each PlannedAction", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV", driver, {
      power: false,
    });

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse("tv[salon].power = on");

    await executeCommand(
      { kind: "run_program", program },
      { devices: [tv], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const stmt = trace.root.children[0]!;
    const execNodes = stmt.children.filter((c) => c.kind === NodeKind.Execute);
    expect(execNodes).toHaveLength(1);
    expect(execNodes[0]!.name).toBe("execute:set_property");
    expect(execNodes[0]!.status).toBe(NodeStatus.Success);
    expect(execNodes[0]!.attributes.deviceId).toBe("tv_salon");
    expect(execNodes[0]!.attributes.property).toBe("power");
  });

  it("traces Execute nodes after Middleware nodes under the same Statement", async () => {
    const driver = makeDriver();
    const tv = await makeDevice("tv_salon", "tv", "salon", "TV", driver, {
      power: false,
    });

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const mw = createConfirmationMiddleware({
      requireConfirmation: () => false,
    });

    const program = parse("tv[salon].power = on");

    await executeCommand(
      { kind: "run_program", program },
      { devices: [tv], middleware: [mw], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const stmt = trace.root.children[0]!;

    const kinds = stmt.children.map((c) => c.kind);
    expect(kinds).toContain(NodeKind.Middleware);
    expect(kinds).toContain(NodeKind.Execute);

    const mwNode = stmt.children.find((c) => c.kind === NodeKind.Middleware)!;
    expect(mwNode.name).toBe("middleware:confirmation");
    expect(mwNode.attributes.decision).toBe("execute");

    const execNode = stmt.children.find((c) => c.kind === NodeKind.Execute)!;
    expect(execNode.name).toBe("execute:set_property");
    expect(execNode.status).toBe(NodeStatus.Success);
  });

  it("traces Execute nodes with invoke_action method", async () => {
    const driver = makeDriver();
    const vacuum = await makeDevice(
      "vacuum_salon",
      "vacuum",
      "salon",
      "Vacuum",
      driver,
      {},
    );

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse("vacuum[salon].start()");

    await executeCommand(
      { kind: "run_program", program },
      { devices: [vacuum], eventBus: bus },
    );

    const trace = tracer.getTrace();
    const execNode = trace.root.children[0]!.children[0]!;
    expect(execNode.kind).toBe(NodeKind.Execute);
    expect(execNode.name).toBe("execute:invoke_action");
    expect(execNode.attributes.method).toBe("start");
  });

  it("full trace tree with middleware, handlers, and execute nodes", async () => {
    const driver = makeDriver();
    const tv1 = await makeDevice("tv_1", "tv", "salon", "TV 1", driver, {
      power: false,
    });
    const tv2 = await makeDevice("tv_2", "tv", "salon", "TV 2", driver, {
      power: false,
    });

    const tracer = new DefaultExecutionTracer();
    const bus = new DefaultVMEventBus(tracer);

    const program = parse("tv[salon].power = on");

    await executeCommand(
      { kind: "run_program", program },
      { devices: [tv1, tv2], eventBus: bus },
    );

    const trace = tracer.getTrace();

    // Shape: Program → Statement → Handler (device_selection)
    const root = trace.root;
    expect(root.kind).toBe(NodeKind.Program);
    expect(root.status).toBe(NodeStatus.Waiting);
    expect(root.children).toHaveLength(1);

    const stmt = root.children[0]!;
    expect(stmt.kind).toBe(NodeKind.Statement);
    expect(stmt.status).toBe(NodeStatus.Waiting);
    expect(stmt.children).toHaveLength(1);

    const handler = stmt.children[0]!;
    expect(handler.kind).toBe(NodeKind.Handler);
    expect(handler.name).toBe("handler:device_selection");
    expect(handler.status).toBe(NodeStatus.Waiting);

    // Should NOT have Execute nodes (execution never happened)
    const execNodes = stmt.children.filter((c) => c.kind === NodeKind.Execute);
    expect(execNodes).toHaveLength(0);
  });
});
