import type { Value, SimpleCondition, ActionOutcome } from '@opennest/lang-core'
import type { DriverRuntimeContext } from '@opennest/devices'
import type { Device, StateChange } from './types.js'
import type { PlannedAction } from './middleware/types.js'
import type { VMEventBus } from './trace/event-bus.js'
import {
  readExpectedEffects,
  resolveVerificationStrategy,
  verifyState,
} from './execution.js'
import type { VerificationTarget } from './execution.js'

export interface ExecutedAction {
  change: StateChange | null
  outcome: ActionOutcome | null
}

export async function executePlannedAction(
  action: PlannedAction,
  runtime: DriverRuntimeContext,
  eventBus?: VMEventBus,
): Promise<ExecutedAction> {
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

  let change: StateChange
  try {
    change = await dispatchCommand(action, runtime)
  } catch (err) {
    eventBus?.emit({
      kind: 'action:end',
      timestamp: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      change: null,
      outcome: {
        deviceId: action.device.id,
        execution: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        },
        verification: { status: 'not_observable' },
      },
    }
  }

  eventBus?.emit({
    kind: 'action:end',
    timestamp: Date.now(),
    status: 'success',
  })

  return { change, outcome: await buildOutcome(action, change, runtime) }
}

async function dispatchCommand(
  action: PlannedAction,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  switch (action.kind) {
    case 'set_property':
      return executeAssignment(
        action.device,
        action.property,
        action.value,
        runtime,
      )
    case 'increment_property':
      return executeIncrement(
        action.device,
        action.property,
        action.value,
        runtime,
      )
    case 'read_property':
      return executeQuery(action.device, action.property, runtime)
    case 'invoke_action':
      return executeAction(action.device, action.method, action.args, runtime)
  }
}

async function buildOutcome(
  action: PlannedAction,
  change: StateChange,
  runtime: DriverRuntimeContext,
): Promise<ActionOutcome | null> {
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
        return {
          deviceId: action.device.id,
          execution: { status: 'accepted' },
          verification: { status: 'not_observable' },
        }
      }
      return verifyOutcome(action.device, target, expected, runtime)
    }
    case 'read_property':
      return null
  }
}

async function verifyOutcome(
  device: Device,
  target: VerificationTarget,
  expected: Record<string, unknown>,
  runtime: DriverRuntimeContext,
): Promise<ActionOutcome> {
  const strategy = resolveVerificationStrategy(device, target)
  try {
    const verification = await verifyState(device, expected, strategy, runtime)
    return {
      deviceId: device.id,
      execution: { status: 'accepted' },
      verification,
    }
  } catch {
    return {
      deviceId: device.id,
      execution: { status: 'accepted' },
      verification: { status: 'not_observable' },
    }
  }
}

export async function executeAssignment(
  device: Device,
  property: string,
  value: Value,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  const oldValue = await device.driver.getProperty(
    device.id,
    property,
    device.driverConfig,
    runtime,
  )
  const newValue = extractValue(value)

  await device.driver.setProperty(
    device.id,
    property,
    newValue,
    device.driverConfig,
    runtime,
  )

  return {
    deviceId: device.id,
    property,
    oldValue,
    newValue,
  }
}

export async function executeIncrement(
  device: Device,
  property: string,
  value: Value,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  const currentValue = await device.driver.getProperty(
    device.id,
    property,
    device.driverConfig,
    runtime,
  )
  const increment = extractNumericValue(value)

  let newValue: unknown
  if (typeof currentValue === 'number') {
    newValue = currentValue + increment
  } else {
    newValue = increment
  }

  await device.driver.setProperty(
    device.id,
    property,
    newValue,
    device.driverConfig,
    runtime,
  )

  return {
    deviceId: device.id,
    property,
    oldValue: currentValue,
    newValue,
  }
}

export async function executeQuery(
  device: Device,
  property: string,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  const currentValue = await device.driver.getProperty(
    device.id,
    property,
    device.driverConfig,
    runtime,
  )

  return {
    deviceId: device.id,
    property,
    oldValue: currentValue,
    newValue: currentValue,
  }
}

export async function executeAction(
  device: Device,
  method: string,
  args: Record<string, Value> | undefined,
  runtime: DriverRuntimeContext,
): Promise<StateChange> {
  const extractedArgs: Record<string, unknown> = {}
  if (args) {
    for (const [name, value] of Object.entries(args)) {
      extractedArgs[name] = extractValue(value)
    }
  }

  await device.driver.executeAction(
    device.id,
    method,
    extractedArgs,
    device.driverConfig,
    runtime,
  )

  return {
    deviceId: device.id,
    property: `action:${method}`,
    oldValue: null,
    newValue: `called`,
  }
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
