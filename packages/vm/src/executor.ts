import type { Value, SimpleCondition } from '@opennest/lang-core'
import type { DriverRuntimeContext } from '@opennest/devices'
import type { Device, StateChange } from './types.js'
import type { PlannedAction } from './middleware/types.js'
import type { VMEventBus } from './trace/event-bus.js'

export async function executePlannedAction(
  action: PlannedAction,
  runtime: DriverRuntimeContext,
  eventBus?: VMEventBus,
): Promise<StateChange> {
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

  try {
    let change: StateChange
    switch (action.kind) {
      case 'set_property':
        change = await executeAssignment(
          action.device,
          action.property,
          action.value,
          runtime,
        )
        break
      case 'increment_property':
        change = await executeIncrement(
          action.device,
          action.property,
          action.value,
          runtime,
        )
        break
      case 'read_property':
        change = await executeQuery(action.device, action.property, runtime)
        break
      case 'invoke_action':
        change = await executeAction(
          action.device,
          action.method,
          action.args,
          runtime,
        )
        break
    }

    eventBus?.emit({
      kind: 'action:end',
      timestamp: Date.now(),
      status: 'success',
    })

    return change
  } catch (err) {
    eventBus?.emit({
      kind: 'action:end',
      timestamp: Date.now(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
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
