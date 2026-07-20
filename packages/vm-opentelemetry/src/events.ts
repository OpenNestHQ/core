export interface NodeStartedEvent {
  type: "node.started";
  nodeId: string;
  parentNodeId?: string;
  kind: string;
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface NodeCompletedEvent {
  type: "node.completed";
  nodeId: string;
  timestamp: number;
  status: "success" | "failed" | "cancelled";
  attributes?: Record<string, unknown>;
}

export interface NodeAttributeEvent {
  type: "node.attribute";
  nodeId: string;
  key: string;
  value: unknown;
}

export interface NodeLogEvent {
  type: "node.event";
  nodeId: string;
  name: string;
  attributes?: Record<string, unknown>;
}

export type ExecutionEvent =
  | NodeStartedEvent
  | NodeCompletedEvent
  | NodeAttributeEvent
  | NodeLogEvent;
