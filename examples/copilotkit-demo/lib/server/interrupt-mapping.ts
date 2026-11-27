import type { Interrupt } from '@ag-ui/core'
import type { ResumeAnswer, UserInteraction } from '@opennest/sdk'
import { REASONS } from '../shared/interrupts'
import type { InterruptMetadata } from '../shared/interrupts'

type JsonSchema = Record<string, unknown>

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema {
  return { type: 'object', properties, required }
}

function responseSchema(interaction: UserInteraction): JsonSchema {
  switch (interaction.type) {
    case 'device_selection':
      return objectSchema(
        {
          deviceId: {
            type: 'string',
            enum: interaction.devices.map(d => d.id),
          },
        },
        ['deviceId'],
      )
    case 'confirmation':
      return objectSchema({ approved: { type: 'boolean' } }, ['approved'])
    case 'choice':
      return objectSchema(
        {
          value: {
            type: 'string',
            enum: interaction.options.map(o => o.value),
          },
        },
        ['value'],
      )
    case 'text_input':
      return objectSchema({ value: { type: 'string', minLength: 1 } }, [
        'value',
      ])
    case 'number_input': {
      const value: JsonSchema = { type: 'number' }
      if (interaction.min !== undefined) value['minimum'] = interaction.min
      if (interaction.max !== undefined) value['maximum'] = interaction.max
      return objectSchema({ value }, ['value'])
    }
    case 'action_parameter':
      return objectSchema(
        {
          values: objectSchema(
            Object.fromEntries(
              interaction.missing.map(p => [
                p.name,
                p.type === 'number'
                  ? { type: 'number' }
                  : p.values !== undefined
                    ? { type: 'string', enum: p.values }
                    : { type: 'string' },
              ]),
            ),
            interaction.missing.map(p => p.name),
          ),
        },
        ['values'],
      )
  }
}

/** Builds the AG-UI interrupt for a VM interaction (id = interaction id). */
export function toInterrupt(
  interaction: UserInteraction,
  opts: { toolCallId?: string; error?: string },
): Interrupt {
  const metadata: InterruptMetadata = { interaction }
  if (opts.error !== undefined) metadata.error = opts.error
  const interrupt: Interrupt = {
    id: interaction.id,
    reason: REASONS[interaction.type],
    message: interaction.message,
    responseSchema: responseSchema(interaction),
    metadata: metadata as unknown as Interrupt['metadata'],
  }
  if (opts.toolCallId !== undefined) interrupt.toolCallId = opts.toolCallId
  return interrupt
}

export type ResumeMapping =
  { ok: true; answer: ResumeAnswer } | { ok: false; message: string }

function field(payload: unknown, key: string): unknown {
  return payload !== null && typeof payload === 'object'
    ? (payload as Record<string, unknown>)[key]
    : undefined
}

const fail = (message: string): ResumeMapping => ({ ok: false, message })

/** Validates a `resume[].payload` and maps it to the SDK answer. */
export function toResumeAnswer(
  interaction: UserInteraction,
  payload: unknown,
): ResumeMapping {
  switch (interaction.type) {
    case 'device_selection': {
      const deviceId = field(payload, 'deviceId')
      if (
        typeof deviceId !== 'string' ||
        !interaction.devices.some(d => d.id === deviceId)
      ) {
        return fail('Pick one of the listed devices.')
      }
      return { ok: true, answer: { type: 'device_selection', deviceId } }
    }
    case 'confirmation': {
      const approved = field(payload, 'approved')
      if (typeof approved !== 'boolean') return fail('Answer yes or no.')
      return { ok: true, answer: { type: 'confirmation', confirmed: approved } }
    }
    case 'choice': {
      const value = field(payload, 'value')
      if (
        typeof value !== 'string' ||
        !interaction.options.some(o => o.value === value)
      ) {
        return fail('Pick one of the listed options.')
      }
      return { ok: true, answer: { type: 'choice', value } }
    }
    case 'text_input': {
      const value = field(payload, 'value')
      if (typeof value !== 'string' || value.trim() === '') {
        return fail('Type an answer.')
      }
      return { ok: true, answer: { type: 'text_input', text: value } }
    }
    case 'number_input': {
      const value = field(payload, 'value')
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail('Enter a number.')
      }
      if (interaction.min !== undefined && value < interaction.min) {
        return fail(`Enter a number of at least ${interaction.min}.`)
      }
      if (interaction.max !== undefined && value > interaction.max) {
        return fail(`Enter a number of at most ${interaction.max}.`)
      }
      return { ok: true, answer: { type: 'number_input', value } }
    }
    case 'action_parameter': {
      const raw = field(payload, 'values')
      if (raw === null || typeof raw !== 'object') {
        return fail('Fill in the missing parameters.')
      }
      const values: Record<string, string> = {}
      for (const param of interaction.missing) {
        const value = (raw as Record<string, unknown>)[param.name]
        if (
          value === undefined ||
          value === null ||
          (typeof value === 'string' && value.trim() === '')
        ) {
          return fail(`Fill in "${param.name}".`)
        }
        if (
          typeof value !== 'string' &&
          typeof value !== 'number' &&
          typeof value !== 'boolean'
        ) {
          return fail(`"${param.name}" must be a simple value.`)
        }
        values[param.name] = String(value)
      }
      return { ok: true, answer: { type: 'action_parameter', values } }
    }
  }
}
