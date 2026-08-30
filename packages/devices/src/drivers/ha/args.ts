import type { ActionParameterConfig } from '../../types.js'
import { isRecord } from './validate.js'

// Validates call-time action arguments against the action's declared
// `parameters` contract (required, type, values, range) before any HA call.
// An action without declared parameters has an open contract: nothing is
// checked, matching the load-time placeholder rules in validate.ts.
export function validateActionArgs(
  deviceId: string,
  action: string,
  parameters: unknown,
  args: Record<string, unknown> | undefined,
): void {
  if (!Array.isArray(parameters)) return
  const declared = parameters.filter(
    (parameter): parameter is ActionParameterConfig =>
      isRecord(parameter) && typeof parameter['name'] === 'string',
  )
  if (declared.length === 0) return

  const provided = args ?? {}
  for (const parameter of declared) {
    const value = provided[parameter.name]
    if (value === undefined) {
      if (parameter.required === true) {
        throw new Error(
          `Missing argument "${parameter.name}" for HA action "${action}" on device "${deviceId}": it is required`,
        )
      }
      continue
    }
    checkValue(deviceId, action, parameter, value)
  }
}

function checkValue(
  deviceId: string,
  action: string,
  parameter: ActionParameterConfig,
  value: unknown,
): void {
  const fail = (detail: string): never => {
    throw new Error(
      `Invalid argument "${parameter.name}" for HA action "${action}" on device "${deviceId}": ${detail}`,
    )
  }
  const describe = (v: unknown): string =>
    typeof v === 'string' ? `"${v}"` : String(v)

  switch (parameter.type) {
    case 'string':
      if (typeof value !== 'string') {
        fail(`must be a string (got ${describe(value)})`)
      }
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(`must be a number (got ${describe(value)})`)
      }
      break
    case 'power':
      if (typeof value !== 'boolean') {
        fail(`must be a power state boolean (got ${describe(value)})`)
      }
      break
    case 'enum':
      if (typeof value !== 'string') {
        fail(`must be one of the declared values (got ${describe(value)})`)
      }
      break
  }

  if (parameter.values !== undefined) {
    if (typeof value !== 'string' || !parameter.values.includes(value)) {
      fail(
        `must be one of ${parameter.values.map(v => `"${v}"`).join(', ')} (got ${describe(value)})`,
      )
    }
  }

  const range = parameter.range
  if (range !== undefined && typeof value === 'number') {
    const [min, max] = range
    if (
      min !== undefined &&
      max !== undefined &&
      (value < min || value > max)
    ) {
      fail(`must be between ${min} and ${max} (got ${describe(value)})`)
    }
  }
}
