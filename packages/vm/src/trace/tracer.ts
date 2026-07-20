import type { VMEvent } from "./events.js";
import type { ExecutionNode, ExecutionTrace } from "./types.js";
import { NodeKind, NodeStatus } from "./types.js";

export interface ExecutionTracer {
  consume(event: VMEvent): void;
  getTrace(): ExecutionTrace;
}

export class DefaultExecutionTracer implements ExecutionTracer {
  private stack: ExecutionNode[] = [];
  private root: ExecutionNode | null = null;
  private idCounter = 0;

  consume(event: VMEvent): void {
    switch (event.kind) {
      case "program:begin":
        this.beginNode(NodeKind.Program, "program", event.timestamp);
        break;
      case "program:end":
        if (event.errorCount !== undefined) {
          this.setAttribute("errorCount", event.errorCount);
        }
        this.endNode(mapEndStatus(event.status), event.timestamp);
        break;
      case "statement:begin":
        this.beginNode(
          NodeKind.Statement,
          `statement[${event.index}]`,
          event.timestamp,
        );
        this.setAttribute("statementKind", event.statementKind);
        break;
      case "statement:end":
        if (event.resolvedDeviceCount !== undefined) {
          this.setAttribute("resolvedDeviceCount", event.resolvedDeviceCount);
        }
        if (event.changeCount !== undefined) {
          this.setAttribute("changeCount", event.changeCount);
        }
        if (event.errors && event.errors.length > 0) {
          this.setAttribute(
            "errors",
            event.errors.map((e) => e.message),
          );
        }
        this.endNode(mapEndStatus(event.status), event.timestamp);
        break;
      case "handler:begin":
        this.beginNode(
          NodeKind.Handler,
          `handler:${event.name}`,
          event.timestamp,
        );
        break;
      case "handler:end":
        this.endNode(mapEndStatus(event.status), event.timestamp);
        break;
      case "policy:begin":
        this.beginNode(
          NodeKind.Policy,
          `policy:${event.name}`,
          event.timestamp,
        );
        this.setAttribute("actionKind", event.actionKind);
        this.setAttribute("deviceId", event.deviceId);
        break;
      case "policy:end":
        this.setAttribute("decision", event.decision);
        if (event.reason !== undefined) {
          this.setAttribute("reason", event.reason);
        }
        this.endNode(mapEndStatus(event.status), event.timestamp);
        break;
      case "action:begin":
        this.beginNode(
          NodeKind.Execute,
          `execute:${event.actionKind}`,
          event.timestamp,
        );
        this.setAttribute("deviceId", event.deviceId);
        this.setAttribute("deviceName", event.deviceName);
        if (event.property !== undefined) {
          this.setAttribute("property", event.property);
        }
        if (event.value !== undefined) {
          this.setAttribute("value", event.value);
        }
        if (event.method !== undefined) {
          this.setAttribute("method", event.method);
        }
        break;
      case "action:end":
        if (event.error !== undefined) {
          this.setAttribute("error", event.error);
        }
        if (event.property !== undefined) {
          this.setAttribute("property", event.property);
        }
        if (event.value !== undefined) {
          this.setAttribute("value", event.value);
        }
        this.endNode(mapEndStatus(event.status), event.timestamp);
        break;
    }
  }

  getTrace(): ExecutionTrace {
    if (!this.root) {
      throw new Error("No trace has been started");
    }
    return { root: this.root };
  }

  private beginNode(
    kind: NodeKind,
    name: string,
    timestamp: number,
  ): void {
    const id = `node_${++this.idCounter}`;
    const parent = this.stack[this.stack.length - 1];
    const node: ExecutionNode = {
      id,
      ...(parent ? { parentId: parent.id } : {}),
      kind,
      name,
      status: NodeStatus.Running,
      startedAt: timestamp,
      attributes: {},
      children: [],
    };

    if (parent) {
      parent.children.push(node);
    } else {
      this.root = node;
    }

    this.stack.push(node);
  }

  private endNode(status: NodeStatus, timestamp: number): void {
    const node = this.stack.pop();
    if (!node) return;
    node.status = status;
    node.endedAt = timestamp;
    node.duration = timestamp - node.startedAt;
  }

  private setAttribute(key: string, value: unknown): void {
    const node = this.stack[this.stack.length - 1];
    if (!node) return;
    node.attributes[key] = value;
  }
}

function mapEndStatus(
  status: "success" | "failed" | "waiting" | "skipped",
): NodeStatus {
  switch (status) {
    case "success":
      return NodeStatus.Success;
    case "failed":
      return NodeStatus.Failed;
    case "waiting":
      return NodeStatus.Waiting;
    case "skipped":
      return NodeStatus.Skipped;
  }
}
