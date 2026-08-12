import type { Middleware, PlannedAction } from './types.js'
import { PauseSignal, BlockSignal } from './types.js'

let nextId = 0

function generateId(): string {
  return `confirm_${++nextId}`
}

function defaultMessage(action: PlannedAction): string {
  const device = action.device
  const label = `${device.name} (${device.type} in ${device.room})`

  switch (action.kind) {
    case 'set_property':
      return `Set ${action.property} on ${label} to ${describeValue(action.value)}?`
    case 'increment_property':
      return `Increment ${action.property} on ${label} by ${describeValue(action.value)}?`
    case 'read_property':
      return `Read ${action.property} from ${label}?`
    case 'invoke_action':
      return `Execute ${action.method}() on ${label}?`
  }
}

function describeValue(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value)
  const v = value as { kind?: string; value?: unknown }
  if (v.kind === 'power') return v.value as string
  if (v.kind === 'number') return String(v.value)
  if (v.kind === 'string') return `"${v.value as string}"`
  return String(v.value ?? value)
}

function propertyOrMethod(action: PlannedAction): string {
  switch (action.kind) {
    case 'set_property':
    case 'read_property':
    case 'increment_property':
      return action.property
    case 'invoke_action':
      return action.method
  }
}

export interface ConfirmationMiddlewareConfig {
  requireConfirmation: (action: PlannedAction) => boolean
  message?: (action: PlannedAction) => string
}

export interface ConfirmationResumeContext {
  fingerprint: string
  decisions: Map<string, boolean>
}

export function createConfirmationMiddleware(
  config: ConfirmationMiddlewareConfig,
): Middleware {
  const decisions = new Map<string, boolean>()
  const formatMessage = config.message ?? defaultMessage

  const mw: Middleware = async (ctx, next) => {
    if (!config.requireConfirmation(ctx.action)) {
      return next()
    }

    const fp = fingerprint(ctx.action)
    const prior = decisions.get(fp)

    if (prior !== undefined) {
      if (prior) {
        return next()
      }
      throw new BlockSignal('Action denied by user')
    }

    throw new PauseSignal(
      {
        id: generateId(),
        type: 'confirmation',
        message: formatMessage(ctx.action),
      },
      { fingerprint: fp, decisions } satisfies ConfirmationResumeContext,
    )
  }

  Object.defineProperty(mw, 'name', { value: 'confirmation' })
  return mw
}

function fingerprint(action: PlannedAction): string {
  return `${action.device.id}::${action.kind}::${propertyOrMethod(action)}`
}
