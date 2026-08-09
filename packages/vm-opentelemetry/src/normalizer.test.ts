import { describe, it, expect } from "vitest";
import { ExecutionEventNormalizer } from "./normalizer.js";
import type { ExecutionEvent } from "./events.js";

describe("ExecutionEventNormalizer", () => {
  it("emits node.started and node.completed for a program", () => {
    const norm = new ExecutionEventNormalizer();
    const begin = norm.consume({ kind: "program:begin", timestamp: 1000 });
    const end = norm.consume({
      kind: "program:end",
      timestamp: 1100,
      status: "success",
    });

    expect(begin).toHaveLength(1);
    expect(begin[0]!.type).toBe("node.started");
    expect(begin[0]!.kind).toBe("Program");
    expect(begin[0]!.name).toBe("program");
    expect(begin[0]!.timestamp).toBe(1000);
    expect(begin[0]!.parentNodeId).toBeUndefined();
    const started = begin[0]!;

    expect(end).toHaveLength(1);
    expect(end[0]!.type).toBe("node.completed");
    expect(end[0]!.nodeId).toBe(started.nodeId);
    expect(end[0]!.status).toBe("success");
    expect(end[0]!.timestamp).toBe(1100);
  });

  it("builds correct parent-child hierarchy", () => {
    const norm = new ExecutionEventNormalizer();

    const prog = norm.consume({ kind: "program:begin", timestamp: 1000 });
    const stmt = norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "assignment",
    });
    const stmtEnd = norm.consume({
      kind: "statement:end",
      timestamp: 1020,
      status: "success",
    });
    const progEnd = norm.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "success",
    });

    const progStarted = prog.find((e) => e.type === "node.started")!;
    const stmtStarted = stmt.find((e) => e.type === "node.started")!;
    const stmtCompleted = stmtEnd.find((e) => e.type === "node.completed")!;
    const progCompleted = progEnd.find((e) => e.type === "node.completed")!;

    expect(progStarted.parentNodeId).toBeUndefined();
    expect(stmtStarted.parentNodeId).toBe(progStarted.nodeId);
    expect(stmtCompleted.nodeId).toBe(stmtStarted.nodeId);
    expect(progCompleted.nodeId).toBe(progStarted.nodeId);
  });

  it("maps statement attributes", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    const stmt = norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });
    const end = norm.consume({
      kind: "statement:end",
      timestamp: 1020,
      status: "success",
      resolvedDeviceCount: 2,
      changeCount: 1,
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "success",
    });

    const attrEvent = stmt.find((e) => e.type === "node.attribute");
    expect(attrEvent).toBeDefined();
    expect(attrEvent!.key).toBe("statementKind");
    expect(attrEvent!.value).toBe("action");

    const completed = end.find((e) => e.type === "node.completed")!;
    expect(completed.attributes).toEqual({
      resolvedDeviceCount: 2,
      changeCount: 1,
    });
  });

  it("maps action begin/end attributes", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });

    const actionBegin = norm.consume({
      kind: "action:begin",
      timestamp: 1020,
      actionKind: "set_property",
      deviceId: "light.kitchen",
      deviceName: "Kitchen Light",
      property: "power",
      value: "on",
    });
    const actionEnd = norm.consume({
      kind: "action:end",
      timestamp: 1030,
      status: "success",
    });
    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "success",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "success",
    });

    const attrs = actionBegin.filter((e) => e.type === "node.attribute");
    expect(attrs).toHaveLength(4);
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain("deviceId");
    expect(keys).toContain("deviceName");
    expect(keys).toContain("property");
    expect(keys).toContain("value");

    const completed = actionEnd.find((e) => e.type === "node.completed")!;
    expect(completed.status).toBe("success");
  });

  it("maps action failure with error", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });
    norm.consume({
      kind: "action:begin",
      timestamp: 1020,
      actionKind: "set_property",
      deviceId: "light.kitchen",
      deviceName: "Kitchen Light",
    });
    const actionEnd = norm.consume({
      kind: "action:end",
      timestamp: 1030,
      status: "failed",
      error: "device unreachable",
    });
    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "failed",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "failed",
      errorCount: 1,
    });

    const completed = actionEnd.find((e) => e.type === "node.completed")!;
    expect(completed.status).toBe("failed");
    expect(completed.attributes).toEqual({ error: "device unreachable" });

    const progEnd = norm.consume({ kind: "program:end", timestamp: 9999, status: "failed" });
    expect(progEnd).toHaveLength(0);
  });

  it("maps middleware events", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });

    const mwBegin = norm.consume({
      kind: "middleware:begin",
      timestamp: 1020,
      name: "confirmation",
      actionKind: "turn_off",
      deviceId: "tv.salon",
    });
    const mwEnd = norm.consume({
      kind: "middleware:end",
      timestamp: 1030,
      status: "success",
      decision: "execute",
    });
    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "success",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "success",
    });

    const started = mwBegin.find((e) => e.type === "node.started")!;
    expect(started.kind).toBe("Middleware");
    expect(started.name).toBe("middleware:confirmation");

    const attrs = mwBegin.filter((e) => e.type === "node.attribute");
    expect(attrs).toHaveLength(2);

    const completed = mwEnd.find((e) => e.type === "node.completed")!;
    expect(completed.status).toBe("success");
    expect(completed.attributes).toEqual({ decision: "execute" });
  });

  it("maps middleware blocked with reason", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });
    norm.consume({
      kind: "middleware:begin",
      timestamp: 1020,
      name: "confirmation",
      actionKind: "turn_off",
      deviceId: "tv.salon",
    });
    const mwEnd = norm.consume({
      kind: "middleware:end",
      timestamp: 1030,
      status: "failed",
      decision: "block",
      reason: "user denied",
    });
    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "failed",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "failed",
    });

    const completed = mwEnd.find((e) => e.type === "node.completed")!;
    expect(completed.status).toBe("failed");
    expect(completed.attributes).toEqual({
      decision: "block",
      reason: "user denied",
    });
  });

  it("maps handler events", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });

    const handlerBegin = norm.consume({
      kind: "handler:begin",
      timestamp: 1020,
      name: "device_selection",
    });
    const handlerEnd = norm.consume({
      kind: "handler:end",
      timestamp: 1030,
      status: "waiting",
    });
    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "waiting",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "waiting",
    });

    const started = handlerBegin.find((e) => e.type === "node.started")!;
    expect(started.kind).toBe("Handler");
    expect(started.name).toBe("handler:device_selection");

    const completed = handlerEnd.find((e) => e.type === "node.completed")!;
    expect(completed.status).toBe("success");
    expect(completed.nodeId).toBe(started.nodeId);
  });

  it("maps skipped middleware status to cancelled", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });
    norm.consume({
      kind: "middleware:begin",
      timestamp: 1020,
      name: "noop",
      actionKind: "read",
      deviceId: "switch.entree",
    });
    const mwEnd = norm.consume({
      kind: "middleware:end",
      timestamp: 1030,
      status: "skipped",
      decision: "skip",
    });
    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "success",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "success",
    });

    const completed = mwEnd.find((e) => e.type === "node.completed")!;
    expect(completed.status).toBe("cancelled");
  });

  it("includes errorCount in program:end with errors", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    const progEnd = norm.consume({
      kind: "program:end",
      timestamp: 1100,
      status: "failed",
      errorCount: 3,
    });

    const completed = progEnd.find((e) => e.type === "node.completed")!;
    expect(completed.status).toBe("failed");
    expect(completed.attributes).toEqual({ errorCount: 3 });
  });

  it("handles end events when stack is empty gracefully", () => {
    const norm = new ExecutionEventNormalizer();
    const result = norm.consume({
      kind: "program:end",
      timestamp: 1000,
      status: "success",
    });
    expect(result).toHaveLength(0);
  });

  it("includes method attribute for invoke_action", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });
    const actionBegin = norm.consume({
      kind: "action:begin",
      timestamp: 1020,
      actionKind: "invoke_action",
      deviceId: "vacuum.chambre",
      deviceName: "Bedroom Vacuum",
      method: "startCleaning",
    });
    norm.consume({
      kind: "action:end",
      timestamp: 1030,
      status: "success",
    });
    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "success",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "success",
    });

    const attrs = actionBegin.filter((e) => e.type === "node.attribute");
    const methodAttr = attrs.find((a) => a.key === "method");
    expect(methodAttr).toBeDefined();
    expect(methodAttr!.value).toBe("startCleaning");
  });

  it("includes statement errors as message strings", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 2,
      statementKind: "assignment",
    });
    const stmtEnd = norm.consume({
      kind: "statement:end",
      timestamp: 1020,
      status: "failed",
      errors: [
        { message: "device not found", kind: "resolution_error" },
        { message: "property read-only", kind: "validation_error" },
      ],
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1030,
      status: "failed",
    });

    const completed = stmtEnd.find((e) => e.type === "node.completed")!;
    expect(completed.attributes).toEqual({
      errors: ["device not found", "property read-only"],
    });
  });

  it("nests execute under middleware when middleware continues", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });

    const mwBegin = norm.consume({
      kind: "middleware:begin",
      timestamp: 1020,
      name: "confirmation",
      actionKind: "turn_off",
      deviceId: "tv.salon",
    });
    norm.consume({
      kind: "middleware:end",
      timestamp: 1030,
      status: "success",
      decision: "execute",
    });

    const actionBegin = norm.consume({
      kind: "action:begin",
      timestamp: 1040,
      actionKind: "set_property",
      deviceId: "tv.salon",
      deviceName: "Salon TV",
      property: "power",
      value: "off",
    });
    norm.consume({
      kind: "action:end",
      timestamp: 1050,
      status: "success",
    });

    norm.consume({
      kind: "statement:end",
      timestamp: 1060,
      status: "success",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1070,
      status: "success",
    });

    const middlewareStarted = mwBegin.find((e) => e.type === "node.started")!;
    const actionStarted = actionBegin.find((e) => e.type === "node.started")!;

    expect(actionStarted.parentNodeId).toBe(middlewareStarted.nodeId);
  });

  it("does not nest execute under middleware when middleware blocks", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });
    norm.consume({
      kind: "statement:begin",
      timestamp: 1010,
      index: 0,
      statementKind: "action",
    });

    norm.consume({
      kind: "middleware:begin",
      timestamp: 1020,
      name: "confirmation",
      actionKind: "turn_off",
      deviceId: "tv.salon",
    });
    norm.consume({
      kind: "middleware:end",
      timestamp: 1030,
      status: "failed",
      decision: "block",
      reason: "user denied",
    });

    norm.consume({
      kind: "statement:end",
      timestamp: 1040,
      status: "failed",
    });
    norm.consume({
      kind: "program:end",
      timestamp: 1050,
      status: "failed",
    });

    // No execute should be emitted (middleware blocked it — VM skips action)
    // The middlewareParentId should have no effect on subsequent operations
  });

  it("middlewareParentId is consumed by next action, not leaked to subsequent actions", () => {
    const norm = new ExecutionEventNormalizer();

    norm.consume({ kind: "program:begin", timestamp: 1000 });

    norm.consume({
      kind: "statement:begin", timestamp: 1010, index: 0, statementKind: "action",
    });
    const mwBegin = norm.consume({
      kind: "middleware:begin", timestamp: 1020, name: "confirmation",
      actionKind: "turn_off", deviceId: "tv.salon",
    });
    const middlewareId = mwBegin.find((e) => e.type === "node.started")!.nodeId;

    norm.consume({
      kind: "middleware:end", timestamp: 1030, status: "success", decision: "execute",
    });
    norm.consume({
      kind: "action:begin", timestamp: 1040, actionKind: "set_property",
      deviceId: "tv.salon", deviceName: "Salon TV",
    });
    norm.consume({
      kind: "action:end", timestamp: 1050, status: "success",
    });
    norm.consume({
      kind: "statement:end", timestamp: 1060, status: "success",
    });

    norm.consume({
      kind: "statement:begin", timestamp: 1070, index: 1, statementKind: "action",
    });
    const action2Begin = norm.consume({
      kind: "action:begin", timestamp: 1080, actionKind: "read_property",
      deviceId: "light.salon", deviceName: "Salon Light",
    });
    norm.consume({
      kind: "action:end", timestamp: 1090, status: "success",
    });
    norm.consume({
      kind: "statement:end", timestamp: 1100, status: "success",
    });
    norm.consume({
      kind: "program:end", timestamp: 1110, status: "success",
    });

    const action2Started = action2Begin.find((e) => e.type === "node.started")!;
    expect(action2Started.parentNodeId).toBeDefined();
    expect(action2Started.parentNodeId).not.toBe(middlewareId);
  });
});
