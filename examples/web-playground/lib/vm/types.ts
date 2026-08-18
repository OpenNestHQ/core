import type {
  Device,
  Session,
  ExecutedStatement,
  VMError,
  UserInteraction,
  VMEvent,
} from '@opennest/sdk'

export interface PolicyInfo {
  name: string
  description: string
  active: boolean
}

export interface VMEventLogEntry {
  id: number
  event: VMEvent
  timestamp: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'vm' | 'system'
  content: string
  timestamp: number
  dsl?: string // rendered DSL when role=user
}

export interface TimelineEntry {
  id: string
  action: string
  deviceName: string
  detail: string
  status: 'success' | 'failed' | 'skipped'
  timestamp: number
}

export type ExecutionStatus =
  'idle' | 'running' | 'awaiting_interaction' | 'error'

export interface VMState {
  devices: Device[]
  session: Session | null
  status: ExecutionStatus
  dslSource: string
  executedStatements: ExecutedStatement[]
  errors: VMError[]
  interaction: UserInteraction | null
  policies: PolicyInfo[]
  events: VMEventLogEntry[]
  messages: ChatMessage[]
  timeline: TimelineEntry[]
}

export type VMAction =
  | { type: 'SET_DEVICES'; devices: Device[] }
  | { type: 'SET_SESSION'; session: Session }
  | { type: 'SET_STATUS'; status: ExecutionStatus }
  | { type: 'SET_DSL'; source: string }
  | { type: 'SET_POLICIES'; policies: PolicyInfo[] }
  | { type: 'ADD_EXECUTED'; statements: ExecutedStatement[] }
  | { type: 'SET_ERRORS'; errors: VMError[] }
  | { type: 'SET_INTERACTION'; interaction: UserInteraction | null }
  | { type: 'ADD_EVENT'; entry: VMEventLogEntry }
  | { type: 'ADD_MESSAGE'; message: ChatMessage }
  | { type: 'ADD_TIMELINE_ENTRIES'; entries: TimelineEntry[] }
  | { type: 'RESET' }
