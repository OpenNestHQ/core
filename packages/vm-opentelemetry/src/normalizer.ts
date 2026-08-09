import type { VMEvent } from "@opennest/vm";
import type { ExecutionEvent } from "./events.js";

export class ExecutionEventNormalizer {
  private stack: string[] = [];
  private idCounter = 0;
  private middlewareParentId: string | undefined;

  consume(event: VMEvent): ExecutionEvent[] {
    switch (event.kind) {
      case "program:begin":
        return this.handleBegin("Program", "program", event.timestamp);

      case "program:end": {
        const nodeId = this.stack.pop();
        if (!nodeId) return [];
        const attrs: Record<string, unknown> = {};
        if (event.errorCount !== undefined) {
          attrs["errorCount"] = event.errorCount;
        }
        return [
          {
            type: "node.completed",
            nodeId,
            timestamp: event.timestamp,
            status: mapStatus(event.status),
            attributes: attrs,
          },
        ];
      }

      case "statement:begin": {
        this.middlewareParentId = undefined;
        const events = this.handleBegin(
          "Statement",
          `statement[${event.index}]`,
          event.timestamp,
        );
        const nodeId = this.stack[this.stack.length - 1]!;
        events.push({
          type: "node.attribute",
          nodeId,
          key: "statementKind",
          value: event.statementKind,
        });
        return events;
      }

      case "statement:end": {
        const nodeId = this.stack.pop();
        if (!nodeId) return [];
        const attrs: Record<string, unknown> = {};
        if (event.resolvedDeviceCount !== undefined) {
          attrs["resolvedDeviceCount"] = event.resolvedDeviceCount;
        }
        if (event.changeCount !== undefined) {
          attrs["changeCount"] = event.changeCount;
        }
        if (event.errors && event.errors.length > 0) {
          attrs["errors"] = event.errors.map((e) => e.message);
        }
        return [
          {
            type: "node.completed",
            nodeId,
            timestamp: event.timestamp,
            status: mapStatus(event.status),
            attributes: attrs,
          },
        ];
      }

      case "handler:begin":
        return this.handleBegin(
          "Handler",
          `handler:${event.name}`,
          event.timestamp,
        );

      case "handler:end": {
        const nodeId = this.stack.pop();
        if (!nodeId) return [];
        return [
          {
            type: "node.completed",
            nodeId,
            timestamp: event.timestamp,
            status: mapStatus(event.status),
          },
        ];
      }

      case "middleware:begin": {
        const events = this.handleBegin(
          "Middleware",
          `middleware:${event.name}`,
          event.timestamp,
        );
        const nodeId = this.stack[this.stack.length - 1]!;
        events.push({
          type: "node.attribute",
          nodeId,
          key: "actionKind",
          value: event.actionKind,
        });
        events.push({
          type: "node.attribute",
          nodeId,
          key: "deviceId",
          value: event.deviceId,
        });
        return events;
      }

      case "middleware:end": {
        const nodeId = this.stack.pop();
        if (!nodeId) return [];
        if (event.decision === "execute") {
          this.middlewareParentId = nodeId;
        }
        const attrs: Record<string, unknown> = {};
        attrs["decision"] = event.decision;
        if (event.reason !== undefined) {
          attrs["reason"] = event.reason;
        }
        return [
          {
            type: "node.completed",
            nodeId,
            timestamp: event.timestamp,
            status: mapStatus(event.status),
            attributes: attrs,
          },
        ];
      }

      case "action:begin": {
        const parentOverride = this.middlewareParentId;
        this.middlewareParentId = undefined;
        const events = this.handleBegin(
          "Execute",
          `execute:${event.actionKind}`,
          event.timestamp,
          parentOverride,
        );
        const nodeId = this.stack[this.stack.length - 1]!;
        events.push({
          type: "node.attribute",
          nodeId,
          key: "deviceId",
          value: event.deviceId,
        });
        events.push({
          type: "node.attribute",
          nodeId,
          key: "deviceName",
          value: event.deviceName,
        });
        if (event.property !== undefined) {
          events.push({
            type: "node.attribute",
            nodeId,
            key: "property",
            value: event.property,
          });
        }
        if (event.value !== undefined) {
          events.push({
            type: "node.attribute",
            nodeId,
            key: "value",
            value: event.value,
          });
        }
        if (event.method !== undefined) {
          events.push({
            type: "node.attribute",
            nodeId,
            key: "method",
            value: event.method,
          });
        }
        return events;
      }

      case "action:end": {
        const nodeId = this.stack.pop();
        if (!nodeId) return [];
        const attrs: Record<string, unknown> = {};
        if (event.error !== undefined) {
          attrs["error"] = event.error;
        }
        if (event.property !== undefined) {
          attrs["property"] = event.property;
        }
        if (event.value !== undefined) {
          attrs["value"] = event.value;
        }
        return [
          {
            type: "node.completed",
            nodeId,
            timestamp: event.timestamp,
            status: mapStatus(event.status),
            attributes: attrs,
          },
        ];
      }
    }
  }

  private handleBegin(
    kind: string,
    name: string,
    timestamp: number,
    parentOverride?: string,
  ): ExecutionEvent[] {
    const nodeId = `node_${++this.idCounter}`;
    const parentNodeId = parentOverride ?? this.stack[this.stack.length - 1];
    this.stack.push(nodeId);
    return [
      {
        type: "node.started",
        nodeId,
        ...(parentNodeId ? { parentNodeId } : {}),
        kind,
        name,
        timestamp,
      },
    ];
  }
}

function mapStatus(
  status: "success" | "failed" | "waiting" | "skipped",
): "success" | "failed" | "cancelled" {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "waiting":
      return "success";
    case "skipped":
      return "cancelled";
  }
}
