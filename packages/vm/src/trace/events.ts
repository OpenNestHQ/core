import type { Value } from '@opennest/lang-core'
import type { VMError } from '../types.js'

export interface ProgramBeginEvent {
  kind: 'program:begin'
  timestamp: number
}

export interface ProgramEndEvent {
  kind: 'program:end'
  timestamp: number
  /** `interrupted` only on a run stopped through `@opennest/vm/effect`. */
  status: 'success' | 'failed' | 'waiting' | 'interrupted'
  errorCount?: number
}

export interface StatementBeginEvent {
  kind: 'statement:begin'
  timestamp: number
  index: number
  statementKind: string
}

export interface StatementEndEvent {
  kind: 'statement:end'
  timestamp: number
  status: 'success' | 'failed' | 'waiting' | 'interrupted'
  resolvedDeviceCount?: number
  changeCount?: number
  errors?: VMError[]
}

export interface HandlerBeginEvent {
  kind: 'handler:begin'
  timestamp: number
  name: string
}

export interface HandlerEndEvent {
  kind: 'handler:end'
  timestamp: number
  status: 'success' | 'failed' | 'waiting'
}

export interface MiddlewareBeginEvent {
  kind: 'middleware:begin'
  timestamp: number
  name: string
  actionKind: string
  deviceId: string
}

export interface MiddlewareEndEvent {
  kind: 'middleware:end'
  timestamp: number
  status: 'success' | 'failed' | 'waiting' | 'skipped'
  decision:
    | 'execute'
    | 'blocked'
    | 'skipped'
    | 'paused'
    | 'block'
    | 'skip'
    | 'pause'
    | 'expand'
  reason?: string
}

export interface ActionBeginEvent {
  kind: 'action:begin'
  timestamp: number
  actionKind: string
  deviceId: string
  deviceName: string
  property?: string
  value?: Value
  method?: string
  args?: Record<string, Value>
}

export interface ActionEndEvent {
  kind: 'action:end'
  timestamp: number
  /** `interrupted`: a stop kept the action from being sent. */
  status: 'success' | 'failed' | 'interrupted'
  error?: string
  property?: string
  value?: Value
}

export type VMEvent =
  | ProgramBeginEvent
  | ProgramEndEvent
  | StatementBeginEvent
  | StatementEndEvent
  | HandlerBeginEvent
  | HandlerEndEvent
  | MiddlewareBeginEvent
  | MiddlewareEndEvent
  | ActionBeginEvent
  | ActionEndEvent
