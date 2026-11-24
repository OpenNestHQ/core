import { Effect } from 'effect'
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
  ActionOutcome,
} from '@opennest/lang-core'
import type {
  Device,
  ExecutedStatement,
  Session,
  VMResult,
  VMError,
  ResolutionIntent,
  ResolutionResult,
  StateChange,
} from './types.js'
import type { UserInteraction, MissingParameter } from './interactions/types.js'
import type { DeviceSelectionContext } from './interactions/device-selection.js'
import type { ActionParameterContext } from './interactions/action-parameter.js'
import type {
  ActionEntryConfig,
  ActionParameterConfig,
  DriverRuntimeContext,
} from '@opennest/devices'
import type { Middleware, PlannedAction } from './middleware/types.js'
import type { VMEventBus } from './trace/event-bus.js'
import type { DriverError, VMInfraError } from './effect/errors.js'
import { createSession } from './state.js'
import { resolveDevices } from './resolver.js'
import { validateProgram } from './validate.js'
import { createInteraction } from './interactions/registry.js'
import { executePlannedActionEffect, evaluateCondition } from './executor.js'
import type { ExecutedAction } from './executor.js'
import { runMiddlewarePipelineEffect } from './middleware/pipeline.js'
import { readProperty } from './effect/driver.js'
import { runPromiseRethrowingOriginal } from './effect/run.js'
import { neverStop, toVMResult } from './effect/stop.js'
import {
  clearSuggestionRun,
  confirmCandidates,
  openConfirmedSuggestions,
  resetPendingTargets,
} from './suggestions/collect.js'
import type { EffectVMResult, StopRequested, StopToken } from './effect/stop.js'

/** Everything a statement needs to run; built once per program run. */
interface InterpreterEnv {
  readonly devices: Device[]
  readonly session: Session
  readonly middleware: Middleware[] | undefined
  readonly eventBus: VMEventBus | undefined
  readonly runtime: DriverRuntimeContext
  readonly stop: StopToken
}

type InterpretResult =
  | { kind: 'success' }
  | {
      kind: 'awaiting_interaction'
      interaction: UserInteraction
      pendingContext: unknown
    }
  | { kind: 'error'; errors: VMError[] }
  /** A stop ended the statement before it finished. */
  | { kind: 'interrupted' }

/** Failures inside a statement; `runTracedStatement` turns a stop into a result. */
type StatementError = VMInfraError | StopRequested

type AwaitingInteraction = Extract<
  InterpretResult,
  { kind: 'awaiting_interaction' }
>

/**
 * Runs a program. Business outcomes (validation errors, ambiguity, blocked
 * actions, driver write failures…) are part of the `VMResult`; only
 * infrastructure failures that abort the run (an `@if` condition read, a
 * middleware throwing a non-signal) are in the error channel. Only a run with
 * a `stop` token can end `interrupted`.
 */
export function interpretProgramEffect(
  program: Program,
  devices: Device[],
  existingSession?: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
  stop: StopToken = neverStop,
): Effect.Effect<EffectVMResult, VMInfraError> {
  return Effect.gen(function* () {
    const session = existingSession ?? createSession()
    const isFresh = !existingSession || existingSession.cursor === 0

    if (isFresh) {
      const validationErrors = validateProgram(program, devices, session)
      if (validationErrors.length > 0) {
        return rejectInvalidProgram(session, validationErrors, eventBus)
      }
    }

    const env: InterpreterEnv = {
      devices,
      session,
      middleware,
      eventBus,
      runtime: { programId: session.programId },
      stop,
    }

    eventBus?.emit({ kind: 'program:begin', timestamp: Date.now() })
    const run = yield* runStatements(program, env)
    return finishProgram(run, env)
  })
}

/** Promise façade of {@link interpretProgramEffect}; rejects with the original error. */
export function interpretProgram(
  program: Program,
  devices: Device[],
  existingSession?: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
): Promise<VMResult> {
  return runPromiseRethrowingOriginal(
    interpretProgramEffect(
      program,
      devices,
      existingSession,
      middleware,
      eventBus,
    ).pipe(Effect.map(toVMResult)),
  )
}

function rejectInvalidProgram(
  session: Session,
  validationErrors: VMError[],
  eventBus: VMEventBus | undefined,
): VMResult {
  eventBus?.emit({ kind: 'program:begin', timestamp: Date.now() })
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

type StatementsRun =
  | { kind: 'finished'; errors: VMError[] }
  /** A statement suspended the run for a user interaction. */
  | { kind: 'suspended'; errors: VMError[]; interaction: UserInteraction }
  /** A stop ended the run after `completedStatements` top-level statements. */
  | { kind: 'interrupted'; errors: VMError[]; completedStatements: number }

/**
 * The top-level statement loop, from `session.cursor` on. A failing statement
 * does not stop the loop; an interaction suspends it and records where to
 * resume; a stop (checked before each statement) ends it as interrupted.
 */
function runStatements(
  program: Program,
  env: InterpreterEnv,
): Effect.Effect<StatementsRun, VMInfraError> {
  return Effect.gen(function* () {
    const { session, stop } = env
    const errors: VMError[] = []

    for (let i = session.cursor; i < program.statements.length; i++) {
      if (stop.isRequested()) {
        return { kind: 'interrupted', errors, completedStatements: i }
      }

      const result = yield* runTracedStatement(program.statements[i]!, i, env)

      if (result.kind === 'awaiting_interaction') {
        suspendProgram(session, program, i, result)
        return { kind: 'suspended', errors, interaction: result.interaction }
      }

      if (result.kind === 'interrupted') {
        return { kind: 'interrupted', errors, completedStatements: i }
      }

      if (result.kind === 'error') errors.push(...result.errors)

      session.resolvedIds = {}
      session.cursor = i + 1
    }

    // A stop during the last statement abandoned part of it (a verification,
    // an aborted write): the run is interrupted even though no statement is left.
    if (stop.isRequested()) {
      return {
        kind: 'interrupted',
        errors,
        completedStatements: program.statements.length,
      }
    }
    return { kind: 'finished', errors }
  })
}

function suspendProgram(
  session: Session,
  program: Program,
  index: number,
  awaiting: AwaitingInteraction,
): void {
  session.pendingInteraction = {
    id: awaiting.interaction.id,
    type: awaiting.interaction.type,
    context: awaiting.pendingContext,
  }
  session._pendingProgram = program
  session.cursor = index
}

function finishProgram(
  run: StatementsRun,
  env: InterpreterEnv,
): EffectVMResult {
  const { session, eventBus } = env

  if (run.kind === 'interrupted') return interruptProgram(run, env)

  if (run.kind === 'suspended') {
    eventBus?.emit({
      kind: 'program:end',
      timestamp: Date.now(),
      status: 'waiting',
    })
    return {
      status: 'awaiting_interaction',
      session,
      executed: session.history,
      interaction: run.interaction,
      errors: run.errors,
    }
  }

  session.cursor = 0
  delete session._pendingProgram

  if (run.errors.length === 0) openConfirmedSuggestions(session)
  clearSuggestionRun(session)

  if (run.errors.length > 0) {
    eventBus?.emit({
      kind: 'program:end',
      timestamp: Date.now(),
      status: 'failed',
      errorCount: run.errors.length,
    })
    return {
      status: 'error',
      session,
      executed: session.history,
      interaction: null,
      errors: run.errors,
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
    ...(session.suggestions && session.suggestions.length > 0
      ? { suggestions: session.suggestions }
      : {}),
  }
}

/**
 * Ends a stopped run. The session keeps what was executed (`history`, `it`,
 * variables) but no pending program, so it can run a new program from scratch.
 */
function interruptProgram(
  run: Extract<StatementsRun, { kind: 'interrupted' }>,
  env: InterpreterEnv,
): EffectVMResult {
  const { session, eventBus } = env
  session.cursor = 0
  session.resolvedIds = {}
  session.pendingInteraction = null
  delete session._pendingProgram
  clearSuggestionRun(session)

  eventBus?.emit({
    kind: 'program:end',
    timestamp: Date.now(),
    status: 'interrupted',
    ...(run.errors.length > 0 ? { errorCount: run.errors.length } : {}),
  })
  return {
    status: 'interrupted',
    session,
    executed: session.history,
    interaction: null,
    errors: run.errors,
    completedStatements: run.completedStatements,
  }
}

/**
 * Runs one statement between its `statement:begin` and `statement:end` events.
 * A `StopRequested` from anywhere inside ends it as `interrupted`, and so does
 * a stop requested before it suspends: a stopped run never asks the user.
 */
function runTracedStatement(
  statement: Statement,
  index: number,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, VMInfraError> {
  return Effect.gen(function* () {
    const { eventBus, session } = env
    eventBus?.emit({
      kind: 'statement:begin',
      timestamp: Date.now(),
      index,
      statementKind: statement.kind,
    })

    const interpreted = yield* interpretStatement(statement, env).pipe(
      Effect.catchTag('StopRequested', () =>
        Effect.succeed<InterpretResult>({ kind: 'interrupted' }),
      ),
    )
    const result: InterpretResult =
      interpreted.kind === 'awaiting_interaction' && env.stop.isRequested()
        ? { kind: 'interrupted' }
        : interpreted

    switch (result.kind) {
      case 'interrupted':
        eventBus?.emit({
          kind: 'statement:end',
          timestamp: Date.now(),
          status: 'interrupted',
        })
        break
      case 'awaiting_interaction':
        eventBus?.emit({
          kind: 'statement:end',
          timestamp: Date.now(),
          status: 'waiting',
        })
        break
      case 'error':
        eventBus?.emit({
          kind: 'statement:end',
          timestamp: Date.now(),
          status: 'failed',
          errors: result.errors,
        })
        break
      case 'success': {
        const lastEntry = session.history[session.history.length - 1]
        eventBus?.emit({
          kind: 'statement:end',
          timestamp: Date.now(),
          status: 'success',
          resolvedDeviceCount: lastEntry?.resolvedDevices.length ?? 0,
          changeCount: lastEntry?.changes.length ?? 0,
        })
        break
      }
    }

    return result
  })
}

function interpretStatement(
  statement: Statement,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return Effect.suspend(() => {
    switch (statement.kind) {
      case 'assignment':
        return interpretAssignment(statement, env)
      case 'query':
        return interpretQuery(statement, env)
      case 'increment':
        return interpretIncrement(statement, env)
      case 'action':
        return interpretAction(statement, env)
      case 'variable_assignment':
        return Effect.succeed(interpretVariableAssignment(statement, env))
      case 'arg_field_assignment':
        return Effect.succeed(
          interpretArgFieldAssignment(statement, env.session),
        )
      case 'arg_bundle_assignment':
        return Effect.succeed(
          interpretArgBundleAssignment(statement, env.session),
        )
      case 'if':
        return interpretIfStatement(statement, env)
    }
  })
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

/**
 * Resolves the devices a statement targets. Returns the resolution when the
 * statement can proceed, or the result that ends it (ambiguity, no match).
 */
function resolveStatementDevices(
  stmt: DeviceStatement,
  intent: ResolutionIntent,
  emptyMessage: string,
  env: InterpreterEnv,
): ResolutionResult | InterpretResult {
  const resolutionResult = resolveDevices(
    stmt.path,
    env.devices,
    env.session,
    intent,
  )

  if (resolutionResult.ambiguous) {
    const { deviceType, variableName } = extractDeviceContext(
      stmt.path,
      env.session,
    )
    return awaitDeviceSelection(
      resolutionResult,
      deviceType,
      variableName,
      env.eventBus,
    )
  }

  if (resolutionResult.devices.length === 0) {
    return {
      kind: 'error',
      errors: [
        {
          statement: stmt,
          message: resolutionResult.noMatchDescription ?? emptyMessage,
        },
      ],
    }
  }

  return resolutionResult
}

function isInterpretResult(
  value: ResolutionResult | InterpretResult,
): value is InterpretResult {
  return 'kind' in value
}

interface PropertyStatementSpec {
  emptyMessage: string
  buildActions: (devices: Device[], name: string) => PlannedAction[]
}

function interpretPropertyStatement(
  stmt: Assignment | Query | Increment,
  spec: PropertyStatementSpec,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return Effect.suspend(() => {
    const name = lastPropertyName(stmt.path)
    const resolution = resolveStatementDevices(
      stmt,
      { kind: 'property', name },
      spec.emptyMessage,
      env,
    )
    if (isInterpretResult(resolution)) return Effect.succeed(resolution)

    const actions = spec.buildActions(resolution.devices, name)
    return applyMiddlewareAndFinish(actions, stmt, resolution, env)
  })
}

function interpretAssignment(
  stmt: Assignment,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return interpretPropertyStatement(
    stmt,
    {
      emptyMessage: 'No devices found for path',
      buildActions: (devices, name) =>
        devices.map(device => ({
          kind: 'set_property',
          device,
          property: name,
          value: stmt.value,
        })),
    },
    env,
  )
}

function interpretQuery(
  stmt: Query,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return interpretPropertyStatement(
    stmt,
    {
      emptyMessage: 'No devices found for query',
      buildActions: (devices, name) =>
        devices.map(device => ({
          kind: 'read_property',
          device,
          property: name,
        })),
    },
    env,
  )
}

function interpretIncrement(
  stmt: Increment,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return interpretPropertyStatement(
    stmt,
    {
      emptyMessage: 'No devices found for increment',
      buildActions: (devices, name) =>
        devices.map(device => ({
          kind: 'increment_property',
          device,
          property: name,
          value: stmt.value,
        })),
    },
    env,
  )
}

function interpretAction(
  stmt: Action,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return Effect.suspend(() => {
    const method = lastPropertyName(stmt.path)
    const resolution = resolveStatementDevices(
      stmt,
      { kind: 'action', name: method },
      'No devices found for action',
      env,
    )
    if (isInterpretResult(resolution)) return Effect.succeed(resolution)

    const effectiveArgs = materializeArgs(stmt, env.session)
    const awaitingParameters = awaitMissingParameters(
      stmt,
      method,
      resolution.devices[0]!,
      effectiveArgs,
      env.eventBus,
    )
    if (awaitingParameters) return Effect.succeed(awaitingParameters)

    const hasArgs = Object.keys(effectiveArgs).length > 0
    const actions: PlannedAction[] = resolution.devices.map(d => ({
      kind: 'invoke_action' as const,
      device: d,
      method,
      ...(hasArgs ? { args: effectiveArgs } : {}),
    }))

    return applyMiddlewareAndFinish(actions, stmt, resolution, env)
  })
}

/** Suspends for an `action_parameter` interaction when required arguments are missing. */
function awaitMissingParameters(
  stmt: Action,
  method: string,
  device: Device,
  effectiveArgs: Record<string, Value>,
  eventBus: VMEventBus | undefined,
): AwaitingInteraction | undefined {
  const missing: MissingParameter[] = getActionParameters(device, method)
    .filter(p => p.required && !(p.name in effectiveArgs))
    .map(p => ({
      name: p.name,
      type: p.type,
      ...(p.values ? { values: p.values } : {}),
    }))

  if (missing.length === 0) return undefined

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

/**
 * Executes a batch of planned actions concurrently (all `@all` targets at
 * once, like `Promise.all`). Never fails: driver errors become outcomes.
 * Once a stop is requested, actions not yet started are not sent.
 */
function executeBatch(
  actions: PlannedAction[],
  env: InterpreterEnv,
): Effect.Effect<ExecutedAction[]> {
  return Effect.forEach(
    actions,
    action =>
      Effect.suspend(() =>
        env.stop.isRequested()
          ? Effect.succeed<ExecutedAction>(notSent)
          : executePlannedActionEffect(
              action,
              env.runtime,
              env.eventBus,
              env.stop,
            ),
      ),
    { concurrency: 'unbounded' },
  )
}

const notSent: ExecutedAction = { change: null, outcome: null, notSent: true }

/**
 * Records a batch in the history and `it`. When a stop kept some actions from
 * being sent, only the sent ones are recorded and the statement is
 * interrupted.
 */
function recordBatch(
  statement: Statement,
  devices: Device[],
  actions: PlannedAction[],
  results: ExecutedAction[],
  filter: Pick<ExecutedStatement, 'filter'>,
  session: Session,
): InterpretResult {
  const interrupted = results.some(r => r.notSent)
  const sentIds = new Set(
    actions.filter((_, i) => !results[i]!.notSent).map(a => a.device.id),
  )
  const sentDevices = interrupted
    ? devices.filter(d => sentIds.has(d.id))
    : devices
  if (sentDevices.length === 0 && interrupted) return { kind: 'interrupted' }

  const { changes, outcomes } = splitExecuted(results)
  session.history.push({
    statement,
    resolvedDevices: sentDevices,
    changes,
    ...(outcomes.length > 0 ? { outcomes } : {}),
    ...filter,
  })
  if (sentDevices[0]) session.it = sentDevices[0]
  confirmCandidates(session, session.cursor, outcomes)

  return interrupted ? { kind: 'interrupted' } : { kind: 'success' }
}

type Approval =
  | { kind: 'approved'; actions: PlannedAction[] }
  | { kind: 'stopped'; result: InterpretResult }

/**
 * Runs each planned action through the middleware chain, in order. Stops at
 * the first block or pause; skipped actions are dropped.
 */
function approveActions(
  actions: PlannedAction[],
  middleware: Middleware[],
  statement: Statement,
  env: InterpreterEnv,
): Effect.Effect<Approval, StatementError> {
  return Effect.gen(function* () {
    const { eventBus } = env
    resetPendingTargets(env.session)
    const pipelineEnv = { session: env.session, devices: env.devices }
    const approved: PlannedAction[] = []

    for (const action of actions) {
      const outcome = yield* runMiddlewarePipelineEffect(
        action,
        middleware,
        pipelineEnv,
        eventBus,
      )

      switch (outcome.kind) {
        case 'execute':
          approved.push(...outcome.actions)
          break

        case 'skipped':
          break

        case 'blocked':
          return {
            kind: 'stopped',
            result: {
              kind: 'error',
              errors: [
                {
                  statement,
                  message: `Blocked by middleware "${outcome.middlewareName}": ${outcome.reason}`,
                },
              ],
            },
          } satisfies Approval

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
            kind: 'stopped',
            result: {
              kind: 'awaiting_interaction',
              interaction: outcome.interaction,
              pendingContext: outcome.context ?? null,
            },
          } satisfies Approval
      }
    }

    return { kind: 'approved', actions: approved } satisfies Approval
  })
}

function applyMiddlewareAndFinish(
  actions: PlannedAction[],
  statement: Statement,
  resolutionResult: ResolutionResult,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return Effect.gen(function* () {
    const { session, middleware } = env
    const filter = resolutionResult.filter
      ? { filter: resolutionResult.filter }
      : {}

    if (!middleware || middleware.length === 0) {
      const results = yield* executeBatch(actions, env)
      return recordBatch(
        statement,
        resolutionResult.devices,
        actions,
        results,
        filter,
        session,
      )
    }

    const approval = yield* approveActions(actions, middleware, statement, env)
    if (approval.kind === 'stopped') return approval.result
    const approved = approval.actions

    if (approved.length === 0) {
      session.history.push({
        statement,
        resolvedDevices: resolutionResult.devices,
        changes: [],
        ...filter,
      })

      return { kind: 'success' } satisfies InterpretResult
    }

    const results = yield* executeBatch(approved, env)
    const approvedIds = new Set(approved.map(a => a.device.id))
    const approvedDevices = resolutionResult.devices.filter(d =>
      approvedIds.has(d.id),
    )
    return recordBatch(
      statement,
      approvedDevices,
      approved,
      results,
      filter,
      session,
    )
  })
}

function splitExecuted(results: ExecutedAction[]): {
  changes: StateChange[]
  outcomes: ActionOutcome[]
} {
  const changes = results
    .map(r => r.change)
    .filter((c): c is StateChange => c !== null)
  const outcomes = results
    .map(r => r.outcome)
    .filter((o): o is ActionOutcome => o !== null)
  return { changes, outcomes }
}

function interpretVariableAssignment(
  stmt: VariableAssignment,
  env: InterpreterEnv,
): InterpretResult {
  const { session } = env

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

      const resolutionResult = resolveDevices(
        pseudoSegments,
        env.devices,
        session,
      )

      if (resolutionResult.ambiguous) {
        return awaitDeviceSelection(
          resolutionResult,
          stmt.value.device.deviceType,
          stmt.name,
          env.eventBus,
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

/**
 * Evaluates the condition, then runs the chosen branch. Unlike the top-level
 * loop, the first failing or suspending body statement ends the `@if`.
 */
function interpretIfStatement(
  stmt: IfStatement,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, StatementError> {
  return Effect.gen(function* () {
    const { session } = env
    const evalResult = yield* evaluateConditionExpr(stmt.condition, env)

    if (evalResult.kind === 'error') {
      return {
        kind: 'error',
        errors: [{ statement: stmt, message: evalResult.message }],
      } satisfies InterpretResult
    }

    const conditionMet = evalResult.value
    const statementsToExecute = conditionMet ? stmt.body : (stmt.elseBody ?? [])
    // Body statements are traced under the index of the enclosing `@if`.
    const stmtIndex = session.cursor

    for (const bodyStmt of statementsToExecute) {
      if (env.stop.isRequested()) {
        return { kind: 'interrupted' } satisfies InterpretResult
      }
      const result = yield* runTracedStatement(bodyStmt, stmtIndex, env)
      if (result.kind !== 'success') return result
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

    return { kind: 'success' } satisfies InterpretResult
  })
}

type ConditionEvalResult =
  { kind: 'ok'; value: boolean } | { kind: 'error'; message: string }

function evaluateConditionExpr(
  expr: ConditionExpr,
  env: InterpreterEnv,
): Effect.Effect<ConditionEvalResult, DriverError | StopRequested> {
  return Effect.gen(function* () {
    if (expr.kind === 'condition') {
      return yield* evaluateSimpleCondition(expr, env)
    }

    if (expr.kind === 'compound_condition') {
      const left = yield* evaluateConditionExpr(expr.left, env)
      if (left.kind === 'error') return left

      if (expr.operator === '&' && !left.value)
        return { kind: 'ok', value: false } satisfies ConditionEvalResult
      if (expr.operator === '|' && left.value)
        return { kind: 'ok', value: true } satisfies ConditionEvalResult

      const right = yield* evaluateConditionExpr(expr.right, env)
      if (right.kind === 'error') return right

      return { kind: 'ok', value: right.value } satisfies ConditionEvalResult
    }

    return { kind: 'ok', value: false } satisfies ConditionEvalResult
  })
}

function evaluateSimpleCondition(
  condition: SimpleCondition,
  env: InterpreterEnv,
): Effect.Effect<ConditionEvalResult, DriverError | StopRequested> {
  return Effect.gen(function* () {
    const { session } = env
    const property = lastPropertyName(condition.path)
    const intent: ResolutionIntent = { kind: 'property', name: property }
    const resolutionResult = resolveDevices(
      condition.path,
      env.devices,
      session,
      intent,
    )

    if (resolutionResult.ambiguous) {
      return conditionError(
        'Ambiguous device in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)',
      )
    }

    if (resolutionResult.devices.length === 0) {
      return conditionError(
        resolutionResult.noMatchDescription ??
          'No devices found for @if condition',
      )
    }

    if (resolutionResult.devices.length > 1) {
      return conditionError(
        'Multiple devices matched in @if condition — use @oneof to pre-resolve: $var = @oneof(device_type)',
      )
    }

    const device = resolutionResult.devices[0]!
    const currentValue = yield* env.stop.abandonOnStop(
      readProperty(device, property, env.runtime),
    )

    session.it = device

    return {
      kind: 'ok',
      value: evaluateCondition(condition, currentValue),
    } satisfies ConditionEvalResult
  })
}

function conditionError(message: string): ConditionEvalResult {
  return { kind: 'error', message }
}
