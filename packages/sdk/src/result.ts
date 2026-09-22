import type { ActionOutcome, Statement } from '@opennest/lang-core'
import type {
  Device,
  ResolutionFilter,
  StateChange,
  UserInteraction,
  VMError,
  VMResult,
  VMStatus,
} from '@opennest/vm'

/** Serializable device metadata — the runtime `driver`/`driverConfig` are omitted. */
export interface DeviceSummary {
  id: string
  type: string
  room: string
  name: string
  owners?: string[]
  tags?: string[]
}

export interface ExecutedStatementSummary {
  statement: Statement
  resolvedDevices: DeviceSummary[]
  changes: StateChange[]
  outcomes?: ActionOutcome[]
  filter?: ResolutionFilter
}

/**
 * Lightweight, JSON-safe projection of a VM execution result, suitable for
 * consumer applications. It carries no live `DeviceDriver` instances or
 * internal session state — use `OpenNestClient.getSession()` for those.
 */
export interface RunResult {
  status: VMStatus
  executed: ExecutedStatementSummary[]
  interaction: UserInteraction | null
  errors: VMError[]
}

function summarizeDevice(device: Device): DeviceSummary {
  return {
    id: device.id,
    type: device.type,
    room: device.room,
    name: device.name,
    ...(device.owners !== undefined ? { owners: device.owners } : {}),
    ...(device.tags !== undefined ? { tags: device.tags } : {}),
  }
}

export function toRunResult(result: VMResult): RunResult {
  return {
    status: result.status,
    executed: result.executed.map(executed => ({
      statement: executed.statement,
      resolvedDevices: executed.resolvedDevices.map(summarizeDevice),
      changes: executed.changes,
      ...(executed.outcomes !== undefined
        ? { outcomes: executed.outcomes }
        : {}),
      ...(executed.filter !== undefined ? { filter: executed.filter } : {}),
    })),
    interaction: result.interaction,
    errors: result.errors,
  }
}
