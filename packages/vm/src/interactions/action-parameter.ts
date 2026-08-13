import type { Action, Value } from '@opennest/lang-core'
import type { Session } from '../types.js'
import type {
  InteractionHandler,
  ActionParameterInteraction,
  MissingParameter,
  UserResponse,
} from './types.js'

export interface ActionParameterContext {
  stmt: Action
  bundleName?: string
  method: string
  deviceName: string
  missing: MissingParameter[]
}

let nextId = 0
function generateId(): string {
  return `interaction_${++nextId}_${Date.now().toString(36)}`
}

function parseUserValue(raw: string, type: MissingParameter['type']): Value {
  switch (type) {
    case 'number':
      return { kind: 'number', value: Number(raw) }
    case 'power':
      return { kind: 'power', value: raw === 'on' ? 'on' : 'off' }
    case 'enum':
    case 'string':
      return { kind: 'string', value: raw }
  }
}

function describeMissing(params: MissingParameter[]): string {
  return params
    .map(p => {
      if (p.type === 'enum' && p.values) {
        return `${p.name}: ${p.values.join('|')}`
      }
      return `${p.name}: ${p.type}`
    })
    .join(', ')
}

export const actionParameterHandler: InteractionHandler<ActionParameterContext> =
  {
    type: 'action_parameter',

    createInteraction(
      context: ActionParameterContext,
    ): ActionParameterInteraction {
      return {
        id: generateId(),
        type: 'action_parameter',
        message: `Missing parameters for ${context.method}() on ${context.deviceName}: ${describeMissing(context.missing)}`,
        deviceName: context.deviceName,
        action: context.method,
        missing: context.missing,
      }
    },

    processResponse(
      session: Session,
      context: ActionParameterContext,
      response: UserResponse,
    ): void {
      if (response.type !== 'action_parameter') return

      for (const param of context.missing) {
        const raw = response.values[param.name]
        if (raw === undefined) continue
        const value = parseUserValue(raw, param.type)

        if (context.bundleName) {
          const bundle = session.argVariables[context.bundleName] ?? {}
          bundle[param.name] = value
          session.argVariables[context.bundleName] = bundle
        } else {
          context.stmt.args = context.stmt.args ?? {}
          context.stmt.args[param.name] = value
        }
      }
    },
  }
