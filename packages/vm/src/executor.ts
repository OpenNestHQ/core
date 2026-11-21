import { Cause, Effect, Result } from 'effect'
import type { Value, SimpleCondition, ActionOutcome } from '@opennest/lang-core'
import type { DriverRuntimeContext } from '@opennest/devices'
import type { Device, StateChange } from './types.js'
import type { PlannedAction } from './middleware/types.js'
import type { VMEventBus } from './trace/event-bus.js'
import {
  readExpectedEffects,
  resolveVerificationStrategy,
  verifyStateEffect,
} from './execution.js'
import type { VerificationTarget } from './execution.js'
import type { DriverError } from './effect/errors.js'
import { readProperty, writeProperty, invokeAction } from './effect/driver.js'
import { runPromiseRethrowingOriginal } from './effect/run.js'

export interface ExecutedAction {
  change: StateChange | null
  outcome: ActionOutcome | null
}

export function executePlannedActionEffect(
  action: PlannedAction,
  runtime: DriverRuntimeContext,
  eventBus?: VMEventBus,
): Effect.Effect<ExecutedAction> {
  return Effect.gen(function* () {
    eventBus?.emit({
      kind: 'action:begin',
      timestamp: Date.now(),
      actionKind: action.kind,
      deviceId: action.device.id,
      deviceName: action.device.name,
      ...('property' in action && 'value' in action
        ? { property: action.property, value: action.value }
        : {}),
      ...('method' in action ? { method: action.method } : {}),
      ...('args' in action && action.args ? { args: action.args } : {}),
    })

    const dispatched = yield* Effect.result(dispatchCommand(action, runtime))
    if (Result.isFailure(dispatched)) {
      const error = errorMessage(dispatched.failure.cause)
      eventBus?.emit({
        kind: 'action:end',
        timestamp: Date.now(),
        status: 'failed',
        error,
      })
      return {
        change: null,
        outcome: {
          deviceId: action.device.id,
          execution: { status: 'failed', error },
          verification: { status: 'not_observable' },
        },
      } satisfies ExecutedAction
    }

    const change = dispatched.success
    eventBus?.emit({
      kind: 'action:end',
      timestamp: Date.now(),
      status: 'success',
    })

    return { change, outcome: yield* buildOutcome(action, change, runtime) }
  })
}

/** Promise façade of {@link executePlannedActionEffect}; never rejects on driver failures. */
export function executePlannedAction(
  action: PlannedAction,
  runtime: DriverRuntimeContext,
  eventBus?: VMEventBus,
): Promise<ExecutedAction> {
  return Effect.runPromise(
    executePlannedActionEffect(action, runtime, eventBus),
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function dispatchCommand(
  action: PlannedAction,
  runtime: DriverRuntimeContext,
): Effect.Effect<StateChange, DriverError> {
  switch (action.kind) {
    case 'set_property':
      return executeAssignmentEffect(
        action.device,
        action.property,
        action.value,
        runtime,
      )
    case 'increment_property':
      return executeIncrementEffect(
        action.device,
        action.property,
        action.value,
        runtime,
      )
    case 'read_property':
      return executeQueryEffect(action.device, action.property, runtime)
    case 'invoke_action':
      return executeActionEffect(
        action.device,
        action.method,
        action.args,
        runtime,
      )
  }
}

function buildOutcome(
  action: PlannedAction,
  change: StateChange,
  runtime: DriverRuntimeContext,
): Effect.Effect<ActionOutcome | null> {
  switch (action.kind) {
    case 'set_property':
    case 'increment_property': {
      const expected = { [action.property]: change.newValue }
      return verifyOutcome(
        action.device,
        { kind: 'property', name: action.property },
        expected,
        runtime,
      )
    }
    case 'invoke_action': {
      const target: VerificationTarget = { kind: 'action', name: action.method }
      const expected = readExpectedEffects(action.device, target)
      if (expected === undefined) {
        return Effect.succeed({
          deviceId: action.device.id,
          execution: { status: 'accepted' },
          verification: { status: 'not_observable' },
        })
      }
      return verifyOutcome(action.device, target, expected, runtime)
    }
    case 'read_property':
      return Effect.succeed(null)
  }
}

function verifyOutcome(
  device: Device,
  target: VerificationTarget,
  expected: Record<string, unknown>,
  runtime: DriverRuntimeContext,
): Effect.Effect<ActionOutcome> {
  const strategy = resolveVerificationStrategy(device, target)
  return verifyStateEffect(device, expected, strategy, runtime).pipe(
    Effect.map((verification): ActionOutcome => ({
      deviceId: device.id,
      execution: { status: 'accepted' },
      verification,
    })),
    // Any verification failure (typed or defect, e.g. a driver throwing
    // synchronously on subscribe) is not_observable, but an interruption must
    // keep propagating so a cooperative stop still works.
    Effect.catchCause(cause =>
      Cause.hasInterrupts(cause)
        ? Effect.interrupt
        : Effect.succeed<ActionOutcome>({
            deviceId: device.id,
            execution: { status: 'accepted' },
            verification: { status: 'not_observable' },
          }),
    ),
  )
}

export function executeAssignmentEffect(
  device: Device,
  property: string,
  value: Value,
  runtime: DriverRuntimeContext,
): Effect.Effect<StateChange, DriverError> {
  return Effect.gen(function* () {
    const oldValue = yield* readProperty(device, property, runtime)
    const newValue = extractValue(value)
    yield* writeProperty(device, property, newValue, runtime)
    return { deviceId: device.id, property, oldValue, newValue }
  })
}

export function executeIncrementEffect(
  device: Device,
  property: string,
  value: Value,
  runtime: DriverRuntimeContext,
): Effect.Effect<StateChange, DriverError> {
  return Effect.gen(function* () {
    const currentValue = yield* readProperty(device, property, runtime)
    const increment = extractNumericValue(value)
    const newValue =
      typeof currentValue === 'number' ? currentValue + increment : increment
    yield* writeProperty(device, property, newValue, runtime)
    return { deviceId: device.id, property, oldValue: currentValue, newValue }
  })
}

export function executeQueryEffect(
  device: Device,
  property: string,
  runtime: DriverRuntimeContext,
): Effect.Effect<StateChange, DriverError> {
  return Effect.map(readProperty(device, property, runtime), currentValue => ({
    deviceId: device.id,
    property,
    oldValue: currentValue,
    newValue: currentValue,
  }))
}

export function executeActionEffect(
  device: Device,
  method: string,
  args: Record<string, Value> | undefined,
  runtime: DriverRuntimeContext,
): Effect.Effect<StateChange, DriverError> {
  const extractedArgs: Record<string, unknown> = {}
  if (args) {
    for (const [name, value] of Object.entries(args)) {
      extractedArgs[name] = extractValue(value)
    }
  }
  return Effect.map(
    invokeAction(device, method, extractedArgs, runtime),
    () => ({
      deviceId: device.id,
      property: `action:${method}`,
      oldValue: null,
      newValue: `called`,
    }),
  )
}

/** Promise façades below reject with the driver's original error. */
export function executeAssignment(
  device: Device,
  property: string,
  value: Value,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  return runPromiseRethrowingOriginal(
    executeAssignmentEffect(device, property, value, runtime),
  )
}

export function executeIncrement(
  device: Device,
  property: string,
  value: Value,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  return runPromiseRethrowingOriginal(
    executeIncrementEffect(device, property, value, runtime),
  )
}

export function executeQuery(
  device: Device,
  property: string,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  return runPromiseRethrowingOriginal(
    executeQueryEffect(device, property, runtime),
  )
}

export function executeAction(
  device: Device,
  method: string,
  args: Record<string, Value> | undefined,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  return runPromiseRethrowingOriginal(
    executeActionEffect(device, method, args, runtime),
  )
}

function extractValue(value: Value): unknown {
  switch (value.kind) {
    case 'power':
      return value.value === 'on'
    case 'number':
      return value.value
    case 'string':
      return value.value
    case 'identifier':
      return value.value
  }
}

function extractNumericValue(value: Value): number {
  switch (value.kind) {
    case 'number':
      return value.value
    case 'power':
      return value.value === 'on' ? 1 : 0
    case 'string': {
      const n = Number(value.value)
      return Number.isNaN(n) ? 0 : n
    }
    case 'identifier': {
      const n = Number(value.value)
      return Number.isNaN(n) ? 0 : n
    }
  }
}

export function evaluateCondition(
  condition: SimpleCondition,
  actualValue: unknown,
): boolean {
  const expected = extractValue(condition.value)

  let normalized = actualValue
  if (typeof actualValue === 'boolean') {
    if (expected === 'on') normalized = true
    if (expected === 'off') normalized = false
  }

  if (condition.op === '==') return normalized == expected
  if (condition.op === '!=') return normalized != expected
  return false
}
