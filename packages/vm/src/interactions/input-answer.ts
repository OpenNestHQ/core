import type {
  ChoiceInteraction,
  ChoiceResponse,
  NumberInputInteraction,
  NumberInputResponse,
  TextInputInteraction,
  TextInputResponse,
} from './types.js'

export type InputAnswerSpec =
  | Pick<TextInputInteraction, 'type'>
  | Pick<NumberInputInteraction, 'type' | 'min' | 'max'>
  | Pick<ChoiceInteraction, 'type' | 'options'>

export type InputAnswerResponse =
  TextInputResponse | NumberInputResponse | ChoiceResponse

export type InputAnswerCheck =
  { ok: true; value: string | number } | { ok: false; message: string }

/**
 * Validates an answer to a `text_input` / `number_input` / `choice` question
 * and returns its normalized value (trimmed text, number, option value). On
 * failure, `message` states what is accepted so the caller can retry.
 */
export function checkInputAnswer(
  spec: InputAnswerSpec,
  response: InputAnswerResponse,
): InputAnswerCheck {
  if (response.type !== spec.type) {
    return {
      ok: false,
      message: `Expected a response of type "${spec.type}", got "${response.type}"`,
    }
  }

  switch (spec.type) {
    case 'text_input': {
      const raw: unknown = (response as TextInputResponse).text
      const text = typeof raw === 'string' ? raw.trim() : ''
      if (text === '') {
        return { ok: false, message: 'Expected a non-empty text' }
      }
      return { ok: true, value: text }
    }
    case 'number_input': {
      const value = (response as NumberInputResponse).value
      const range = describeRange(spec.min, spec.max)
      if (
        !Number.isFinite(value) ||
        (spec.min !== undefined && value < spec.min) ||
        (spec.max !== undefined && value > spec.max)
      ) {
        return {
          ok: false,
          message: `Expected a finite number${range}, got ${value}`,
        }
      }
      return { ok: true, value }
    }
    case 'choice': {
      const value = (response as ChoiceResponse).value
      if (
        typeof value !== 'string' ||
        !spec.options.some(option => option.value === value)
      ) {
        const accepted = spec.options.map(o => `"${o.value}"`).join(', ')
        return {
          ok: false,
          message: `Expected one of ${accepted}, got "${value}"`,
        }
      }
      return { ok: true, value }
    }
  }
}

function describeRange(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) {
    return ` between ${min} and ${max} (inclusive)`
  }
  if (min !== undefined) return ` >= ${min}`
  if (max !== undefined) return ` <= ${max}`
  return ''
}
