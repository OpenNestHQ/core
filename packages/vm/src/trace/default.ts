import { NodeStatus } from "./types.js";
import type { ExecutionNode, ExecutionTrace, ExecutionTracer, NodeKind } from "./types.js";

export class DefaultExecutionTracer implements ExecutionTracer {
  private root: ExecutionNode | null = null;
  private stack: ExecutionNode[] = [];
  private counter = 0;

  beginNode(kind: NodeKind, name: string): void {
    const node: ExecutionNode = {
      id: `node-${++this.counter}`,
      kind,
      name,
      status: NodeStatus.Running,
      startedAt: Date.now(),
      attributes: {},
      children: [],
    };

    const parent = this.stack[this.stack.length - 1];
    if (parent) {
      node.parentId = parent.id;
      parent.children.push(node);
    } else {
      this.root = node;
    }

    this.stack.push(node);
  }

  endSuccess(): void {
    this.popNode(NodeStatus.Success);
  }

  endFailed(error?: unknown): void {
    const node = this.stack[this.stack.length - 1];
    if (node && error !== undefined) {
      node.attributes["error"] = String(error);
    }
    this.popNode(NodeStatus.Failed);
  }

  endWaiting(): void {
    this.popNode(NodeStatus.Waiting);
  }

  attribute(key: string, value: unknown): void {
    const node = this.stack[this.stack.length - 1];
    if (node) {
      node.attributes[key] = value;
    }
  }

  getTrace(): ExecutionTrace {
    if (!this.root) {
      throw new Error("No trace root — beginNode was never called");
    }
    return { root: this.root };
  }

  private popNode(status: NodeStatus): void {
    const node = this.stack.pop();
    if (!node) return;
    node.status = status;
    node.endedAt = Date.now();
    node.duration = node.endedAt - node.startedAt;
  }
}
