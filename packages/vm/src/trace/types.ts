export enum NodeStatus {
  Running = "running",
  Success = "success",
  Failed = "failed",
  Waiting = "waiting",
  Skipped = "skipped",
}

export enum NodeKind {
  Program = "program",
  Statement = "statement",
  ResolveDevice = "resolve_device",
  Policy = "policy",
  Handler = "handler",
  Execute = "execute",
  Step = "step",
}

export interface ExecutionNode {
  id: string;
  parentId?: string;
  kind: NodeKind;
  name: string;
  status: NodeStatus;
  startedAt: number;
  endedAt?: number;
  duration?: number;
  attributes: Record<string, unknown>;
  children: ExecutionNode[];
}

export interface ExecutionTrace {
  root: ExecutionNode;
}

export interface ExecutionTracer {
  beginNode(kind: NodeKind, name: string): void;
  endSuccess(): void;
  endFailed(error?: unknown): void;
  endWaiting(): void;
  attribute(key: string, value: unknown): void;
  getTrace(): ExecutionTrace;
}
