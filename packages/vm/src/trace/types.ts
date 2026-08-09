export enum NodeStatus {
  Running = "Running",
  Success = "Success",
  Failed = "Failed",
  Waiting = "Waiting",
  Skipped = "Skipped",
}

export enum NodeKind {
  Program = "Program",
  Statement = "Statement",
  Step = "Step",
  Handler = "Handler",
  Middleware = "Middleware",
  Execute = "Execute",
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
