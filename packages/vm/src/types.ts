import type {
  Statement,
  DeviceRef,
  CollectionModifier,
  Program,
  Value,
} from '@opennest/lang-core'
import type { DeviceDriver } from '@opennest/devices'
import type {
  UserInteraction,
  PendingInteraction,
} from './interactions/types.js'
import type { Middleware } from './middleware/types.js'
import type { VMEventBus } from './trace/event-bus.js'

export interface Device {
  id: string
  type: string
  room: string
  name: string
  driver: DeviceDriver
  driverConfig: Record<string, unknown>
  owners?: string[]
  tags?: string[]
}

export interface StateChange {
  deviceId: string
  property: string
  oldValue: unknown
  newValue: unknown
}

export interface ExecutedStatement {
  statement: Statement
  resolvedDevices: Device[]
  changes: StateChange[]
  filter?: ResolutionFilter
}

export interface Session {
  programId: string
  variables: Record<string, DeviceRef>
  argVariables: Record<string, Record<string, Value>>
  it: Device | null
  history: ExecutedStatement[]
  cursor: number
  resolvedIds: Record<string, string>
  variableResolvedIds: Record<string, string>
  variableModifiers: Record<string, CollectionModifier>
  pendingInteraction: PendingInteraction | null
  _pendingProgram?: Program
}

export interface VMError {
  statement: Statement
  message: string
}

export type VMStatus = 'success' | 'awaiting_interaction' | 'error'

export interface VMResult {
  status: VMStatus
  session: Session
  executed: ExecutedStatement[]
  interaction: UserInteraction | null
  errors: VMError[]
}

export interface VMContext {
  devices: Device[]
  session?: Session
  middleware?: Middleware[]
  eventBus?: VMEventBus
}

export interface ResolutionIntent {
  kind: 'property' | 'action'
  name: string
}

export interface ExcludedDevice {
  deviceId: string
  deviceName: string
  reason: 'property_not_supported' | 'action_not_supported'
  details: string
}

export interface ResolutionFilter {
  candidates: number
  matched: number
  excluded: ExcludedDevice[]
}

export interface ResolutionResult {
  devices: Device[]
  ambiguous: boolean
  filter?: ResolutionFilter
  noMatchDescription?: string
}
