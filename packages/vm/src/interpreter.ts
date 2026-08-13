import type {
  Program,
  Statement,
  Assignment,
  Query,
  Increment,
  Action,
  VariableAssignment,
  ArgFieldAssignment,
  ArgBundleAssignment,
  IfStatement,
  DeviceRef,
  ConditionExpr,
  SimpleCondition,
  Value,
} from '@opennest/lang-core'
import type {
  Device,
  Session,
  VMResult,
  VMError,
  ResolutionIntent,
  ResolutionResult,
} from './types.js'
import type { UserInteraction, MissingParameter } from './interactions/types.js'
import type { DeviceSelectionContext } from './interactions/device-selection.js'
import type { ActionParameterContext } from './interactions/action-parameter.js'
import type {
  ActionEntryConfig,
  ActionParameterConfig,
} from '@opennest/devices'
import type { Middleware, PlannedAction } from './middleware/types.js'
import type { VMEventBus } from './trace/event-bus.js'
import { createSession } from './state.js'
import { resolveDevices } from './resolver.js'
import { validateProgram } from './validate.js'
import { createInteraction } from './interactions/registry.js'
import { executePlannedAction, evaluateCondition } from './executor.js'
import { runMiddlewarePipeline } from './middleware/pipeline.js'

export async function interpretProgram(
  program: Program,
  devices: Device[],
  existingSession?: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<VMResult> {
  const session = existingSession ?? createSession()
  const isFresh = !existingSession || existingSession.cursor === 0

  if (isFresh) {
    const validationErrors = validateProgram(program, devices, session)
    if (validationErrors.length > 0) {
      eventBus?.emit({
        kind: 'program:begin',
        timestamp: Date.now(),
      })
      eventBus?.emit({
        kind: 'program:end',
        timestamp: Date.now(),
        status: 'failed',
        errorCount: validationErrors.length,
      })
      return {
        status: 'error',
        session,
        executed: [],
        interaction: null,
        errors: validationErrors,
      }
    }
  }

  eventBus?.emit({
    kind: 'program:begin',
    timestamp: Date.now(),
  })

  const errors: VMError[] = []
  let awaiting = false
  let interactionResult: UserInteraction | null = null

  for (let i = session.cursor; i < program.statements.length; i++) {
    const statement = program.statements[i]!

    eventBus?.emit({
      kind: 'statement:begin',
      timestamp: Date.now(),
      index: i,
      statementKind: statement.kind,
    })

    const result = await interpretStatement(
      statement,
      devices,
      session,
      middleware,
      eventBus,
    )

    if (result.kind === 'awaiting_interaction') {
      eventBus?.emit({
        kind: 'statement:end',
        timestamp: Date.now(),
        status: 'waiting',
      })
      awaiting = true
      interactionResult = result.interaction
      session.pendingInteraction = {
        id: result.interaction.id,
        type: result.interaction.type,
        context: result.pendingContext,
      }
      session._pendingProgram = program
      session.cursor = i
      break
    }

    if (result.kind === 'error') {
      eventBus?.emit({
        kind: 'statement:end',
        timestamp: Date.now(),
        status: 'failed',
        errors: result.errors,
      })
      errors.push(...result.errors)
    } else {
      const lastEntry = session.history[session.history.length - 1]
      const resolvedCount = lastEntry?.resolvedDevices.length ?? 0
      const changeCount = lastEntry?.changes.length ?? 0
      eventBus?.emit({
        kind: 'statement:end',
        timestamp: Date.now(),
        status: 'success',
        resolvedDeviceCount: resolvedCount,
        changeCount,
      })
    }

    session.resolvedIds = {}

    session.cursor = i + 1
  }

  if (!awaiting) {
    session.cursor = 0
    delete session._pendingProgram
  }

  if (awaiting) {
    eventBus?.emit({
      kind: 'program:end',
      timestamp: Date.now(),
      status: 'waiting',
    })
    return {
      status: 'awaiting_interaction',
      session,
      executed: session.history,
      interaction: interactionResult,
      errors,
    }
  }

  if (errors.length > 0) {
    eventBus?.emit({
      kind: 'program:end',
      timestamp: Date.now(),
      status: 'failed',
      errorCount: errors.length,
    })
    return {
      status: 'error',
      session,
      executed: session.history,
      interaction: null,
      errors,
    }
  }

  eventBus?.emit({
    kind: 'program:end',
    timestamp: Date.now(),
    status: 'success',
  })
  return {
    status: 'success',
    session,
    executed: session.history,
    interaction: null,
    errors: [],
  }
}

type InterpretResult =
  | { kind: 'success' }
  | {
      kind: 'awaiting_interaction'
      interaction: UserInteraction
      pendingContext: unknown
    }
  | { kind: 'error'; errors: VMError[] }

async function interpretStatement(
  statement: Statement,
  devices: Device[],
  session: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  switch (statement.kind) {
    case 'assignment':
      return interpretAssignment(
        statement,
        devices,
        session,
        middleware,
        eventBus,
      )
    case 'query':
      return interpretQuery(statement, devices, session, middleware, eventBus)
    case 'increment':
      return interpretIncrement(
        statement,
        devices,
        session,
        middleware,
        eventBus,
      )
    case 'action':
      return interpretAction(statement, devices, session, middleware, eventBus)
    case 'variable_assignment':
      return interpretVariableAssignment(statement, devices, session, eventBus)
    case 'arg_field_assignment':
      return interpretArgFieldAssignment(statement, session)
    case 'arg_bundle_assignment':
      return interpretArgBundleAssignment(statement, session)
    case 'if':
      return interpretIfStatement(
        statement,
        devices,
        session,
        middleware,
        eventBus,
      )
  }
}

function awaitDeviceSelection(
  result: ResolutionResult,
  deviceType: string,
  variableName: string | undefined,
  eventBus?: VMEventBus,
): InterpretResult {
  const ctx: DeviceSelectionContext = {
    devices: result.devices,
    deviceType,
    variableName,
  }
  return {
    kind: 'awaiting_interaction',
    interaction: createInteraction('device_selection', ctx, eventBus),
    pendingContext: ctx,
  }
}

function extractDeviceContext(
  path: { identifier: string; isVariable?: boolean }[],
  session: Session,
): { deviceType: string; variableName: string | undefined } {
  const firstSeg = path[0]
  if (!firstSeg) return { deviceType: 'unknown', variableName: undefined }

  if (firstSeg.isVariable) {
    const varRef = session.variables[firstSeg.identifier]
    return {
      deviceType: varRef?.deviceType ?? firstSeg.identifier,
      variableName: firstSeg.identifier,
    }
  }

  return { deviceType: firstSeg.identifier, variableName: undefined }
}

type DeviceStatement = Assignment | Query | Increment | Action

interface DeviceStatementSpec {
  intentKind: ResolutionIntent['kind']
  emptyMessage: string
  buildActions: (devices: Device[], name: string) => PlannedAction[]
}

async function interpretDeviceStatement(
  stmt: DeviceStatement,
  spec: DeviceStatementSpec,
  devices: Device[],
  session: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  const name = lastPropertyName(stmt.path)
  const intent: ResolutionIntent = { kind: spec.intentKind, name }
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent)

  if (resolutionResult.ambiguous) {
    const { deviceType, variableName } = extractDeviceContext(
      stmt.path,
      session,
    )
    return awaitDeviceSelection(
      resolutionResult,
      deviceType,
      variableName,
      eventBus,
    )
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: 'error',
      errors: [
        {
          statement: stmt,
          message: resolutionResult.noMatchDescription ?? spec.emptyMessage,
        },
      ],
    }
  }

  const actions: PlannedAction[] = spec.buildActions(
    resolutionResult.devices,
    name,
  )

  return applyMiddlewareAndFinish(
    actions,
    middleware,
    session,
    devices,
    stmt,
    resolutionResult,
    eventBus,
  )
}

async function interpretAssignment(
  stmt: Assignment,
  devices: Device[],
  session: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  return interpretDeviceStatement(
    stmt,
    {
      intentKind: 'property',
      emptyMessage: 'No devices found for path',
      buildActions: (devices, name) =>
        devices.map(device => ({
          kind: 'set_property',
          device,
          property: name,
          value: stmt.value,
        })),
    },
    devices,
    session,
    middleware,
    eventBus,
  )
}

async function interpretQuery(
  stmt: Query,
  devices: Device[],
  session: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  return interpretDeviceStatement(
    stmt,
    {
      intentKind: 'property',
      emptyMessage: 'No devices found for query',
      buildActions: (devices, name) =>
        devices.map(device => ({
          kind: 'read_property',
          device,
          property: name,
        })),
    },
    devices,
    session,
    middleware,
    eventBus,
  )
}

async function interpretIncrement(
  stmt: Increment,
  devices: Device[],
  session: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  return interpretDeviceStatement(
    stmt,
    {
      intentKind: 'property',
      emptyMessage: 'No devices found for increment',
      buildActions: (devices, name) =>
        devices.map(device => ({
          kind: 'increment_property',
          device,
          property: name,
          value: stmt.value,
        })),
    },
    devices,
    session,
    middleware,
    eventBus,
  )
}

async function interpretAction(
  stmt: Action,
  devices: Device[],
  session: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  const method = lastPropertyName(stmt.path)
  const intent: ResolutionIntent = { kind: 'action', name: method }
  const resolutionResult = resolveDevices(stmt.path, devices, session, intent)

  if (resolutionResult.ambiguous) {
    const { deviceType, variableName } = extractDeviceContext(
      stmt.path,
      session,
    )
    return awaitDeviceSelection(
      resolutionResult,
      deviceType,
      variableName,
      eventBus,
    )
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: 'error',
      errors: [
        {
          statement: stmt,
          message:
            resolutionResult.noMatchDescription ??
            'No devices found for action',
        },
      ],
    }
  }

  const effectiveArgs = materializeArgs(stmt, session)
  const device = resolutionResult.devices[0]!
  const missing: MissingParameter[] = getActionParameters(device, method)
    .filter(p => p.required && !(p.name in effectiveArgs))
    .map(p => ({
      name: p.name,
      type: p.type,
      ...(p.values ? { values: p.values } : {}),
    }))

  if (missing.length > 0) {
    const ctx: ActionParameterContext = {
      stmt,
      method,
      deviceName: device.name,
      missing,
      ...(stmt.argBundle?.name !== undefined
        ? { bundleName: stmt.argBundle.name }
        : {}),
    }
    return {
      kind: 'awaiting_interaction',
      interaction: createInteraction('action_parameter', ctx, eventBus),
      pendingContext: ctx,
    }
  }

  const hasArgs = Object.keys(effectiveArgs).length > 0
  const actions: PlannedAction[] = resolutionResult.devices.map(d => ({
    kind: 'invoke_action' as const,
    device: d,
    method,
    ...(hasArgs ? { args: effectiveArgs } : {}),
  }))

  return applyMiddlewareAndFinish(
    actions,
    middleware,
    session,
    devices,
    stmt,
    resolutionResult,
    eventBus,
  )
}

function materializeArgs(
  stmt: Action,
  session: Session,
): Record<string, Value> {
  if (stmt.argBundle) {
    return { ...(session.argVariables[stmt.argBundle.name] ?? {}) }
  }
  return { ...(stmt.args ?? {}) }
}

function getActionParameters(
  device: Device,
  method: string,
): ActionParameterConfig[] {
  const actions = device.driverConfig['actions'] as
    string[] | Record<string, ActionEntryConfig> | undefined
  if (!actions || Array.isArray(actions)) return []
  return actions[method]?.parameters ?? []
}

async function applyMiddlewareAndFinish(
  actions: PlannedAction[],
  middleware: Middleware[] | undefined,
  session: Session,
  devices: Device[],
  statement: Statement,
  resolutionResult: ResolutionResult,
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  if (!middleware || middleware.length === 0) {
    const changes = await Promise.all(
      actions.map(action => executePlannedAction(action, eventBus)),
    )

    session.history.push({
      statement,
      resolvedDevices: resolutionResult.devices,
      changes,
      ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
    })

    if (resolutionResult.devices[0]) {
      session.it = resolutionResult.devices[0]
    }

    return { kind: 'success' }
  }

  const env = { session, devices }
  const approved: PlannedAction[] = []

  for (const action of actions) {
    const outcome = await runMiddlewarePipeline(
      action,
      middleware,
      env,
      eventBus,
    )

    switch (outcome.kind) {
      case 'execute':
        approved.push(...outcome.actions)
        break

      case 'blocked':
        return {
          kind: 'error',
          errors: [
            {
              statement,
              message: `Blocked by middleware "${outcome.middlewareName}": ${outcome.reason}`,
            },
          ],
        }

      case 'skipped':
        continue

      case 'paused':
        eventBus?.emit({
          kind: 'handler:begin',
          timestamp: Date.now(),
          name: outcome.interaction.type,
        })
        eventBus?.emit({
          kind: 'handler:end',
          timestamp: Date.now(),
          status: 'waiting',
        })
        return {
          kind: 'awaiting_interaction',
          interaction: outcome.interaction,
          pendingContext: outcome.context ?? null,
        }
    }
  }

  if (approved.length === 0) {
    session.history.push({
      statement,
      resolvedDevices: resolutionResult.devices,
      changes: [],
      ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
    })

    return { kind: 'success' }
  }

  const changes = await Promise.all(
    approved.map(action => executePlannedAction(action, eventBus)),
  )

  const resolvedIds = new Set(approved.map(a => a.device.id))
  const executedDevices = resolutionResult.devices.filter(d =>
    resolvedIds.has(d.id),
  )

  session.history.push({
    statement,
    resolvedDevices: executedDevices,
    changes,
    ...(resolutionResult.filter ? { filter: resolutionResult.filter } : {}),
  })

  if (executedDevices[0]) {
    session.it = executedDevices[0]
  }

  return { kind: 'success' }
}

async function interpretVariableAssignment(
  stmt: VariableAssignment,
  devices: Device[],
  session: Session,
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  if (stmt.value.kind === 'device_ref') {
    session.variables[stmt.name] = stmt.value
    delete session.variableResolvedIds[stmt.name]
    session.history.push({
      statement: stmt,
      resolvedDevices: [],
      changes: [],
    })
    return { kind: 'success' }
  }

  if (stmt.value.kind === 'collection') {
    const deviceRef: DeviceRef = {
      kind: 'device_ref',
      deviceType: stmt.value.device.deviceType,
      selectors: stmt.value.device.selectors,
    }

    if (stmt.value.modifier === '@oneof') {
      const pseudoSegments = [
        {
          identifier: stmt.value.device.deviceType,
          selectors: stmt.value.device.selectors,
        },
      ]

      const resolutionResult = resolveDevices(pseudoSegments, devices, session)

      if (resolutionResult.ambiguous) {
        return awaitDeviceSelection(
          resolutionResult,
          stmt.value.device.deviceType,
          stmt.name,
          eventBus,
        )
      }

      if (resolutionResult.devices.length === 0) {
        return {
          kind: 'error',
          errors: [
            {
              statement: stmt,
              message:
                resolutionResult.noMatchDescription ??
                `No devices found for @oneof(${stmt.value.device.deviceType})`,
            },
          ],
        }
      }

      const device = resolutionResult.devices[0]!
      session.variables[stmt.name] = deviceRef
      session.variableResolvedIds[stmt.name] = device.id
      session.variableModifiers[stmt.name] = '@oneof'
      session.it = device
      session.history.push({
        statement: stmt,
        resolvedDevices: [device],
        changes: [],
      })
      return { kind: 'success' }
    }

    session.variables[stmt.name] = deviceRef
    session.variableModifiers[stmt.name] = stmt.value.modifier
    delete session.variableResolvedIds[stmt.name]
    session.history.push({
      statement: stmt,
      resolvedDevices: [],
      changes: [],
    })
    return { kind: 'success' }
  }

  session.history.push({
    statement: stmt,
    resolvedDevices: [],
    changes: [],
  })
  return { kind: 'success' }
}

function lastPropertyName(path: { identifier: string }[]): string {
  const lastSegment = path[path.length - 1]
  if (!lastSegment) return ''
  return lastSegment.identifier
}

function interpretArgFieldAssignment(
  stmt: ArgFieldAssignment,
  session: Session,
): InterpretResult {
  const bundle = session.argVariables[stmt.name] ?? {}
  bundle[stmt.field] = stmt.value
  session.argVariables[stmt.name] = bundle
  session.history.push({
    statement: stmt,
    resolvedDevices: [],
    changes: [],
  })
  return { kind: 'success' }
}

function interpretArgBundleAssignment(
  stmt: ArgBundleAssignment,
  session: Session,
): InterpretResult {
  session.argVariables[stmt.name] = { ...stmt.values }
  session.history.push({
    statement: stmt,
    resolvedDevices: [],
    changes: [],
  })
  return { kind: 'success' }
}

async function interpretIfStatement(
  stmt: IfStatement,
  devices: Device[],
  session: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<InterpretResult> {
  const evalResult = await evaluateConditionExpr(
    stmt.condition,
    devices,
    session,
    eventBus,
  )

  if (evalResult.kind === 'error') {
    return {
      kind: 'error',
      errors: [{ statement: stmt, message: evalResult.message }],
    }
  }

  const conditionMet = evalResult.value

  const statementsToExecute = conditionMet ? stmt.body : (stmt.elseBody ?? [])

  const stmtIndex = session.cursor

  for (let bi = 0; bi < statementsToExecute.length; bi++) {
    const bodyStmt = statementsToExecute[bi]!

    eventBus?.emit({
      kind: 'statement:begin',
      timestamp: Date.now(),
      index: stmtIndex,
      statementKind: bodyStmt.kind,
    })

    const result = await interpretStatement(
      bodyStmt,
      devices,
      session,
      middleware,
      eventBus,
    )

    if (result.kind === 'awaiting_interaction') {
      eventBus?.emit({
        kind: 'statement:end',
        timestamp: Date.now(),
        status: 'waiting',
      })
      return result
    }

    if (result.kind === 'error') {
      eventBus?.emit({
        kind: 'statement:end',
        timestamp: Date.now(),
        status: 'failed',
        errors: result.errors,
      })
      return result
    }

    const lastEntry = session.history[session.history.length - 1]
    const resolvedCount = lastEntry?.resolvedDevices.length ?? 0
    const changeCount = lastEntry?.changes.length ?? 0
    eventBus?.emit({
      kind: 'statement:end',
      timestamp: Date.now(),
      status: 'success',
      resolvedDeviceCount: resolvedCount,
      changeCount,
    })
  }

  session.history.push({
    statement: stmt,
    resolvedDevices: [],
    changes: [
      {
        deviceId: '',
        property: 'condition',
        oldValue: null,
        newValue: conditionMet,
      },
    ],
  })

  return { kind: 'success' }
}

type ConditionEvalResult =
  { kind: 'ok'; value: boolean } | { kind: 'error'; message: string }

async function evaluateConditionExpr(
  expr: ConditionExpr,
  devices: Device[],
  session: Session,
  eventBus?: VMEventBus,
): Promise<ConditionEvalResult> {
  if (expr.kind === 'condition') {
    return evaluateSimpleCondition(expr, devices, session)
  }

  if (expr.kind === 'compound_condition') {
    const left = await evaluateConditionExpr(
      expr.left,
      devices,
      session,
      eventBus,
    )
    if (left.kind === 'error') return left

    if (expr.operator === '&' && !left.value)
      return { kind: 'ok', value: false }
    if (expr.operator === '|' && left.value) return { kind: 'ok', value: true }

    const right = await evaluateConditionExpr(
      expr.right,
      devices,
      session,
      eventBus,
    )
    if (right.kind === 'error') return right

    return { kind: 'ok', value: right.value }
  }

  return { kind: 'ok', value: false }
}

async function evaluateSimpleCondition(
  condition: SimpleCondition,
  devices: Device[],
  session: Session,
): Promise<ConditionEvalResult> {
  const property = lastPropertyName(condition.path)
  const intent: ResolutionIntent = { kind: 'property', name: property }
  const resolutionResult = resolveDevices(
    condition.path,
    devices,
    session,
    intent,
  )

  if (resolutionResult.ambiguous) {
    return {
      kind: 'error',
      message:
        'Ambiguous device in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)',
    }
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: 'error',
      message:
        resolutionResult.noMatchDescription ??
        'No devices found for @if condition',
    }
  }

  if (resolutionResult.devices.length > 1) {
    return {
      kind: 'error',
      message:
        'Multiple devices matched in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)',
    }
  }

  const device = resolutionResult.devices[0]!
  const currentValue = await device.driver.getProperty(
    device.id,
    property,
    device.driverConfig,
  )

  session.it = device

  return { kind: 'ok', value: evaluateCondition(condition, currentValue) }
}
