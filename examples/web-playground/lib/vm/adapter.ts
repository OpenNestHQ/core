import {
  OpenNestClient,
  createConfirmationMiddleware,
  DefaultVMEventBus,
} from '@opennest/sdk'
import type {
  Session,
  Device,
  Middleware,
  UserInteraction,
  UserResponse,
  VMResult,
  VMEvent,
  PlannedAction,
} from '@opennest/sdk'
import { createPlaygroundDevices } from './devices'
import type {
  VMEventLogEntry,
  ChatMessage,
  TimelineEntry,
  PolicyInfo,
} from './types'

// ── Middleware ──

function createDemoMiddleware(): Middleware[] {
  const confirmLights = createConfirmationMiddleware({
    requireConfirmation(action: PlannedAction) {
      return (
        action.device.type === 'light' &&
        action.kind === 'set_property' &&
        action.property === 'power'
      )
    },
  })

  const confirmThermostat = createConfirmationMiddleware({
    requireConfirmation(action: PlannedAction) {
      return (
        action.device.type === 'thermostat' &&
        action.kind === 'set_property' &&
        action.property === 'temperature'
      )
    },
  })

  return [confirmLights, confirmThermostat]
}

// ── VM Adapter ──

export class VMAdapter {
  private client: OpenNestClient
  private middlewareList: Middleware[]
  private devices: Device[]
  private eventIdCounter = 0

  private onEvent: (entry: VMEventLogEntry) => void
  private onSessionUpdate: (session: Session) => void

  constructor(
    onEvent: (entry: VMEventLogEntry) => void,
    onSessionUpdate: (session: Session) => void,
  ) {
    const fixture = createPlaygroundDevices()
    this.devices = fixture.devices
    this.middlewareList = createDemoMiddleware()
    this.onEvent = onEvent
    this.onSessionUpdate = onSessionUpdate
    this.client = this.createClient()
  }

  private createClient(): OpenNestClient {
    const eventBus = new DefaultVMEventBus()
    eventBus.subscribe((event: VMEvent) => {
      const entry: VMEventLogEntry = {
        id: ++this.eventIdCounter,
        event,
        timestamp: Date.now(),
      }
      this.onEvent(entry)
    })
    return new OpenNestClient({
      devices: this.devices,
      middleware: this.middlewareList,
      eventBus,
    })
  }

  getDevices(): Device[] {
    return this.devices
  }

  getSession(): Session {
    return this.client.getSession()
  }

  getPolicies(): PolicyInfo[] {
    const seen = new Map<string, number>()
    return this.middlewareList.map(mw => {
      const name = (mw as { name?: string }).name ?? 'anonymous'
      const count = seen.get(name) ?? 0
      seen.set(name, count + 1)
      return {
        name: count > 0 ? `${name}_${count + 1}` : name,
        description: getPolicyDescription(name),
        active: true,
      }
    })
  }

  async executeDSL(source: string): Promise<VMResult> {
    const normalized = source.replace(/\r\n/g, '\n')
    const feedback = this.client.analyze(normalized)
    if (feedback.parseErrors.length > 0) {
      return {
        status: 'error',
        session: this.client.getSession(),
        executed: [],
        interaction: null,
        errors: feedback.parseErrors.map(e => ({
          statement: {
            kind: 'action' as const,
            path: [],
          },
          message: `Parse error at line ${e.line}:${e.column}: ${e.message}`,
        })),
      }
    }

    const result = await this.client.execute(feedback.program!)

    this.onSessionUpdate(this.client.getSession())
    return result
  }

  async resumeInteraction(response: UserResponse): Promise<VMResult> {
    const result = await this.client.resume(response)

    this.onSessionUpdate(this.client.getSession())
    return result
  }

  async cancelExecution(): Promise<VMResult> {
    const result = await this.client.cancel()
    this.onSessionUpdate(this.client.getSession())
    return result
  }

  resetSession(): void {
    this.eventIdCounter = 0
    this.middlewareList = createDemoMiddleware()
    this.client = this.createClient()
    this.onSessionUpdate(this.client.getSession())
  }
}

function getPolicyDescription(name: string): string {
  switch (name) {
    case 'confirmation':
      return 'Pauses execution to ask for user confirmation before executing matching actions.'
    default:
      return ''
  }
}

// ── Helpers ──

function stmtLabel(kind: string, property: string): string {
  switch (kind) {
    case 'assignment':
      return `SetProperty:${property}`
    case 'query':
      return `ReadProperty:${property}`
    case 'increment':
      return `IncrementProperty:${property}`
    default:
      return `${kind}:${property}`
  }
}

export function buildTimelineEntries(
  result: VMResult,
  prevHistoryLen: number,
): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (let i = prevHistoryLen; i < result.executed.length; i++) {
    const stmt = result.executed[i]!
    const devices = stmt.resolvedDevices
    if (devices.length > 0) {
      for (const device of devices) {
        for (const change of stmt.changes) {
          if (change.deviceId === device.id) {
            const actionLabel = stmtLabel(stmt.statement.kind, change.property)
            entries.push({
              id: `${stmt.statement.kind}-${i}-${device.id}-${change.property}`,
              action: actionLabel,
              deviceName: device.name,
              detail: `${change.oldValue} → ${change.newValue}`,
              status: 'success',
              timestamp: Date.now(),
            })
          }
        }
        if (stmt.statement.kind === 'action') {
          const hasChange = stmt.changes.some(c => c.deviceId === device.id)
          if (!hasChange) {
            entries.push({
              id: `${stmt.statement.kind}-${i}-${device.id}`,
              action: 'InvokeAction',
              deviceName: device.name,
              detail:
                stmt.statement.path[stmt.statement.path.length - 1]
                  ?.identifier ?? '',
              status: 'success',
              timestamp: Date.now(),
            })
          }
        }
      }
    }
  }
  return entries
}

let _msgId = 0

export function buildChatMessage(
  role: 'user' | 'vm' | 'system',
  content: string,
  dsl?: string,
): ChatMessage {
  return {
    id: `msg_${++_msgId}`,
    role,
    content,
    timestamp: Date.now(),
    dsl,
  }
}

export function formatInteractionMessage(interaction: UserInteraction): string {
  switch (interaction.type) {
    case 'device_selection':
      return `Device selection: ${interaction.message}`
    case 'confirmation':
      return `Confirmation: ${interaction.message}`
    case 'text_input':
      return `Input: ${interaction.message}`
    case 'number_input':
      return `Number: ${interaction.message}`
    case 'choice':
      return `Choice: ${interaction.message}`
    case 'action_parameter':
      return `Missing parameters: ${interaction.message}`
  }
}
