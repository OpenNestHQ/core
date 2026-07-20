import type { Value } from "@opennest/lang-core/dist/ast/index.js";
import type { VMError } from "../types.js";

export interface ProgramBeginEvent {
  kind: "program:begin";
  timestamp: number;
}

export interface ProgramEndEvent {
  kind: "program:end";
  timestamp: number;
  status: "success" | "failed" | "waiting";
  errorCount?: number;
}

export interface StatementBeginEvent {
  kind: "statement:begin";
  timestamp: number;
  index: number;
  statementKind: string;
}

export interface StatementEndEvent {
  kind: "statement:end";
  timestamp: number;
  status: "success" | "failed" | "waiting";
  resolvedDeviceCount?: number;
  changeCount?: number;
  errors?: VMError[];
}

export interface HandlerBeginEvent {
  kind: "handler:begin";
  timestamp: number;
  name: string;
}

export interface HandlerEndEvent {
  kind: "handler:end";
  timestamp: number;
  status: "success" | "failed" | "waiting";
}

export interface PolicyBeginEvent {
  kind: "policy:begin";
  timestamp: number;
  name: string;
  actionKind: string;
  deviceId: string;
}

export interface PolicyEndEvent {
  kind: "policy:end";
  timestamp: number;
  status: "success" | "failed" | "waiting" | "skipped";
  decision: "continue" | "block" | "skip" | "pause" | "replace" | "expand";
  reason?: string;
}

export interface ActionBeginEvent {
  kind: "action:begin";
  timestamp: number;
  actionKind: string;
  deviceId: string;
  deviceName: string;
  property?: string;
  value?: Value;
  method?: string;
}

export interface ActionEndEvent {
  kind: "action:end";
  timestamp: number;
  status: "success" | "failed";
  error?: string;
  property?: string;
  value?: Value;
}

export type VMEvent =
  | ProgramBeginEvent
  | ProgramEndEvent
  | StatementBeginEvent
  | StatementEndEvent
  | HandlerBeginEvent
  | HandlerEndEvent
  | PolicyBeginEvent
  | PolicyEndEvent
  | ActionBeginEvent
  | ActionEndEvent;
