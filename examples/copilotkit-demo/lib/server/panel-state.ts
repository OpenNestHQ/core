import type { Program, RunResult, VMEvent } from '@opennest/sdk'
import type { ExecutionNode, ExecutionTrace } from '@opennest/vm'
import type {
  DemoState,
  PanelDevice,
  PanelStatement,
  ProgramOrigin,
  StatementStatus,
  TraceNode,
} from '../shared/state'
import type { House } from './house'

type Statement = Program['statements'][number]
type Segment = Extract<Statement, { kind: 'assignment' }>['path'][number]
type Value = Extract<Statement, { kind: 'assignment' }>['value']
type Selector = Segment['selectors'][number]

const ICONS: Record<string, string> = {
  tv: '📺',
  light: '💡',
  speaker: '🔊',
  thermostat: '🌡',
  fan: '🌀',
  blind: '🪟',
  camera: '📷',
  vacuum: '🧹',
  nightstand: '🛏',
  door: '🚪',
  switch: '🔌',
}

export function iconFor(type: string): string {
  return ICONS[type] ?? '⚙'
}

export function initialState(
  devices: PanelDevice[],
  llmConfigured: boolean,
): DemoState {
  return {
    program: null,
    statements: [],
    trace: null,
    pending: null,
    suggestions: [],
    devices,
    llm: { configured: llmConfigured },
  }
}

/** Reads every declared property of every device, in parallel. */
export async function readDevices(house: House): Promise<PanelDevice[]> {
  return Promise.all(
    house.devices.map(async device => {
      const declared = device.driverConfig['properties']
      const names =
        declared !== null && typeof declared === 'object'
          ? Object.keys(declared)
          : []
      const values = await Promise.all(
        names.map(name =>
          device.driver.getProperty(device.id, name, device.driverConfig),
        ),
      )
      const state: Record<string, unknown> = {}
      names.forEach((name, i) => {
        state[name] = values[i] ?? null
      })
      return {
        id: device.id,
        name: device.name,
        room: device.room,
        type: device.type,
        icon: iconFor(device.type),
        state,
      }
    }),
  )
}

// ──── Basic-mode summaries ────

interface Target {
  type: string
  room: string | null
  owner: string | null
  all: boolean
}

function words(identifier: string): string {
  return identifier.replace(/_/g, ' ')
}

function typeLabel(type: string, plural: boolean): string {
  const base = type === 'tv' ? 'TV' : words(type)
  return plural ? `${base}s` : base
}

function targetFromSelectors(
  type: string,
  selectors: Selector[],
  all: boolean,
): Target {
  let room: string | null = null
  let owner: string | null = null
  for (const s of selectors) {
    if (s.kind === 'room') room = s.name
    if (s.kind === 'owner') owner = s.name
  }
  return { type, room, owner, all }
}

/** "living room TV", "Alice's light", "living room lights". */
function describe(target: Target): string {
  const parts: string[] = []
  if (target.owner !== null) parts.push(`${target.owner}'s`)
  if (target.room !== null) parts.push(words(target.room))
  parts.push(typeLabel(target.type, target.all))
  return parts.join(' ')
}

/** Adds "the" unless the phrase starts with a possessive. */
function the(target: Target): string {
  const text = describe(target)
  return target.owner !== null ? text : `the ${text}`
}

function valueLabel(value: Value): string {
  return typeof value.value === 'number'
    ? String(value.value)
    : words(value.value)
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function resolveTarget(
  head: Segment | undefined,
  vars: Map<string, Target>,
): Target | null {
  if (head === undefined) return null
  if (head.isVariable === true) return vars.get(head.identifier) ?? null
  return targetFromSelectors(head.identifier, head.selectors, false)
}

function summarize(
  statement: Statement,
  index: number,
  vars: Map<string, Target>,
): string {
  const fallback = `Step ${index + 1}`
  switch (statement.kind) {
    case 'variable_assignment': {
      const { value } = statement
      if (value.kind === 'device_ref') {
        const target = targetFromSelectors(
          value.deviceType,
          value.selectors,
          false,
        )
        vars.set(statement.name, target)
        return capitalize(`find ${the(target)}`)
      }
      if (value.kind === 'collection') {
        const all = value.modifier === '@all'
        const target = targetFromSelectors(
          value.device.deviceType,
          value.device.selectors,
          all,
        )
        vars.set(statement.name, target)
        return capitalize(
          all ? `find all ${describe(target)}` : `find ${the(target)}`,
        )
      }
      return fallback
    }
    case 'assignment': {
      const target = resolveTarget(statement.path[0], vars)
      const property = statement.path[1]?.identifier
      if (target === null || property === undefined) return fallback
      if (property === 'power' && statement.value.kind === 'power') {
        return `Turn ${statement.value.value} ${the(target)}`
      }
      return capitalize(
        `${describe(target)} → ${words(property)} ${valueLabel(statement.value)}`,
      )
    }
    case 'increment': {
      const target = resolveTarget(statement.path[0], vars)
      const property = statement.path[1]?.identifier
      if (target === null || property === undefined) return fallback
      return capitalize(
        `${describe(target)} → ${words(property)} +${valueLabel(statement.value)}`,
      )
    }
    case 'query': {
      const target = resolveTarget(statement.path[0], vars)
      const property = statement.path[1]?.identifier
      if (target === null || property === undefined) return fallback
      return `Check ${the(target)} ${words(property)}`
    }
    case 'action': {
      const target = resolveTarget(statement.path[0], vars)
      const method = statement.path[1]?.identifier
      if (target === null || method === undefined) return fallback
      return capitalize(`${words(method)} ${the(target)}`)
    }
    default:
      return fallback
  }
}

/** One plain-English label per top-level statement (no DSL syntax). */
export function summarizeProgram(program: Program): string[] {
  const vars = new Map<string, Target>()
  return program.statements.map((statement, index) =>
    summarize(statement, index, vars),
  )
}

// ──── Reducers ────

export function beginProgram(
  state: DemoState,
  program: Program,
  dsl: string,
  origin: ProgramOrigin,
): DemoState {
  const summaries = summarizeProgram(program)
  return {
    ...state,
    program: { programId: '', dsl, origin },
    statements: program.statements.map((statement, index) => ({
      index,
      kind: statement.kind,
      summary: summaries[index] ?? `Step ${index + 1}`,
      status: 'pending',
      devices: [],
      middleware: [],
    })),
    trace: null,
    pending: null,
    suggestions: [],
  }
}

function updateStatement(
  state: DemoState,
  index: number,
  update: (statement: PanelStatement) => PanelStatement,
): DemoState {
  return {
    ...state,
    statements: state.statements.map(s => (s.index === index ? update(s) : s)),
  }
}

function runningIndex(state: DemoState): number | null {
  for (let i = state.statements.length - 1; i >= 0; i--) {
    const s = state.statements[i]!
    if (s.status === 'running') return s.index
  }
  return null
}

function withoutWrite(statement: PanelStatement): PanelStatement {
  const copy = { ...statement }
  delete copy.lastWrite
  return copy
}

function rawValue(value: Value): unknown {
  return value.kind === 'power' ? value.value === 'on' : value.value
}

function setDeviceState(
  state: DemoState,
  deviceId: string,
  property: string,
  value: unknown,
): DemoState {
  return {
    ...state,
    devices: state.devices.map(d =>
      d.id === deviceId
        ? { ...d, state: { ...d.state, [property]: value } }
        : d,
    ),
  }
}

const STATEMENT_END: Record<string, StatementStatus> = {
  success: 'success',
  failed: 'error',
  waiting: 'waiting',
  interrupted: 'skipped',
}

/** Folds one VM trace event into the panel state. */
export function applyVmEvent(state: DemoState, event: VMEvent): DemoState {
  switch (event.kind) {
    case 'statement:begin': {
      const existing = state.statements.find(s => s.index === event.index)
      if (existing === undefined) {
        // Follow-up steps (answered suggestions) are not in the program.
        return {
          ...state,
          statements: [
            ...state.statements,
            {
              index: event.index,
              kind: event.statementKind,
              summary: `Follow-up step ${event.index + 1}`,
              status: 'running',
              devices: [],
              middleware: [],
              startedAt: event.timestamp,
            },
          ],
        }
      }
      return updateStatement(state, event.index, s => ({
        ...s,
        status: 'running',
        startedAt: s.startedAt ?? event.timestamp,
      }))
    }
    case 'statement:end': {
      const index = runningIndex(state)
      if (index === null) return state
      return updateStatement(state, index, s => {
        const blocked =
          event.status === 'failed' &&
          s.middleware.some(m => / → block(ed)?$/.test(m))
        const next: PanelStatement = {
          ...s,
          status: blocked
            ? 'blocked'
            : (STATEMENT_END[event.status] ?? 'error'),
        }
        if (s.startedAt !== undefined && event.status !== 'waiting') {
          next.durationMs = event.timestamp - s.startedAt
        }
        // Keep the middleware's plain reason ("wrong PIN") over the VM's
        // technical wrapper ("Blocked by middleware ...").
        const first = event.errors?.[0]
        if (first !== undefined) next.reason ??= first.message
        return next
      })
    }
    case 'middleware:begin': {
      const index = runningIndex(state)
      if (index === null) return state
      return updateStatement(state, index, s => ({
        ...s,
        middleware: [...s.middleware, event.name],
      }))
    }
    case 'middleware:end': {
      const index = runningIndex(state)
      if (index === null) return state
      return updateStatement(state, index, s => {
        const middleware = [...s.middleware]
        const last = middleware.pop()
        if (last === undefined) return s
        // A plain pass-through is noise; keep only real decisions.
        if (event.decision !== 'execute') {
          middleware.push(`${last} → ${event.decision}`)
        }
        const next: PanelStatement = { ...s, middleware }
        if (
          (event.decision === 'blocked' || event.decision === 'block') &&
          event.reason !== undefined
        ) {
          next.reason = event.reason
        }
        return next
      })
    }
    case 'action:begin': {
      const index = runningIndex(state)
      if (index === null) return state
      const device = state.devices.find(d => d.id === event.deviceId)
      return updateStatement(state, index, s => {
        const rest = withoutWrite(s)
        const next: PanelStatement = s.devices.some(
          d => d.id === event.deviceId,
        )
          ? rest
          : {
              ...rest,
              devices: [
                ...s.devices,
                {
                  id: event.deviceId,
                  name: event.deviceName,
                  icon: device?.icon ?? '⚙',
                },
              ],
            }
        if (event.property !== undefined && event.value !== undefined) {
          next.lastWrite = {
            deviceId: event.deviceId,
            property: event.property,
            value: rawValue(event.value),
          }
        }
        return next
      })
    }
    case 'action:end': {
      const index = runningIndex(state)
      if (index === null) return state
      const statement = state.statements.find(s => s.index === index)
      const write = statement?.lastWrite
      if (write === undefined) return state
      const cleared = updateStatement(state, index, withoutWrite)
      if (event.status !== 'success') return cleared
      return setDeviceState(
        cleared,
        write.deviceId,
        write.property,
        write.value,
      )
    }
    default:
      return state
  }
}

/** Merges the SDK result: resolution, outcomes, suggestions, programId. */
export function applyRunResult(
  state: DemoState,
  result: RunResult,
  programId: string,
  historyStart = 0,
): DemoState {
  // `executed` is the whole session history: this program's entries start
  // at `historyStart` (the history length when the program began).
  const entries = result.executed.slice(historyStart)
  const statements = state.statements.map((s, i): PanelStatement => {
    let next = s
    const entry = entries[i]
    if (entry !== undefined) {
      next = { ...next }
      if (entry.filter !== undefined) {
        next.resolution = {
          candidates: entry.filter.candidates,
          matched: entry.filter.matched,
          excluded: entry.filter.excluded.map(e => ({
            id: e.deviceId,
            reason: e.reason,
          })),
        }
      }
      if (entry.outcomes !== undefined) {
        next.outcomes = entry.outcomes.map(o => ({
          deviceId: o.deviceId,
          execution: o.execution.status,
          verification: o.verification.status,
        }))
      }
    }
    if (result.status === 'awaiting_interaction' && next.status === 'running') {
      next = { ...next, status: 'waiting' }
    }
    return next
  })
  let next: DemoState = {
    ...state,
    program: state.program === null ? null : { ...state.program, programId },
    statements,
    // The caller sets a new question when the run paused again.
    pending: null,
    suggestions: result.status === 'success' ? (result.suggestions ?? []) : [],
  }
  // Changes are the VM's record of what was written: authoritative.
  for (const entry of entries) {
    for (const change of entry.changes) {
      next = setDeviceState(
        next,
        change.deviceId,
        change.property,
        change.newValue,
      )
    }
  }
  return next
}

/** The user cancelled the open question: nothing else of the program runs. */
export function cancelProgram(state: DemoState): DemoState {
  return {
    ...state,
    statements: state.statements.map(s =>
      s.status === 'pending' || s.status === 'running' || s.status === 'waiting'
        ? withoutWrite({ ...s, status: 'skipped' })
        : s,
    ),
    pending: null,
    suggestions: [],
  }
}

function toTraceNode(node: ExecutionNode): TraceNode {
  const out: TraceNode = {
    name: node.name,
    kind: String(node.kind),
    status: String(node.status),
    children: node.children.map(toTraceNode),
  }
  if (node.duration !== undefined) out.durationMs = node.duration
  return out
}

export function withTrace(state: DemoState, trace: ExecutionTrace): DemoState {
  return { ...state, trace: toTraceNode(trace.root) }
}
