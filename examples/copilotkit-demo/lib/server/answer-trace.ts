import type {
  ResumeAnswer,
  SuggestionResponse,
  SuggestionSummary,
  UserInteraction,
} from '@opennest/sdk'
import type { AnswerTrace } from '../shared/answer-trace'

/** Text answers to these questions are secrets: never shown in the chat. */
const SECRET_QUESTION = /\b(pin|password|passcode|code)\b/i
const MASK = '••••'

function withDetail(
  base: Omit<AnswerTrace, 'detail'>,
  detail: string | undefined,
): AnswerTrace {
  return detail === undefined || detail === base.answer
    ? base
    : { ...base, detail }
}

/** A VM question the user answered. */
export function questionTrace(
  interaction: UserInteraction,
  answer: ResumeAnswer,
): AnswerTrace {
  const base = {
    kind: 'question' as const,
    type: interaction.type,
    question: interaction.message,
    status: 'answered' as const,
  }
  if (
    interaction.type === 'device_selection' &&
    answer.type === 'device_selection'
  ) {
    const device = interaction.devices.find(d => d.id === answer.deviceId)
    return withDetail(
      { ...base, answer: device?.name ?? answer.deviceId },
      answer.deviceId,
    )
  }
  if (answer.type === 'confirmation') {
    return { ...base, answer: answer.confirmed ? 'Yes' : 'No' }
  }
  if (interaction.type === 'choice' && answer.type === 'choice') {
    const option = interaction.options.find(o => o.value === answer.value)
    return withDetail(
      { ...base, answer: option?.label ?? answer.value },
      answer.value,
    )
  }
  if (answer.type === 'text_input') {
    return {
      ...base,
      answer: SECRET_QUESTION.test(interaction.message) ? MASK : answer.text,
    }
  }
  if (answer.type === 'number_input') {
    return { ...base, answer: String(answer.value) }
  }
  if (answer.type === 'action_parameter') {
    return {
      ...base,
      answer: Object.entries(answer.values)
        .map(([name, value]) => `${name}: ${value}`)
        .join(', '),
    }
  }
  return { ...base, answer: answer.type }
}

/** A VM question the user cancelled. */
export function cancelledTrace(interaction: UserInteraction): AnswerTrace {
  return {
    kind: 'question',
    type: interaction.type,
    question: interaction.message,
    answer: 'Cancelled',
    status: 'cancelled',
  }
}

/** The label of a suggestion answer (the option label for a choice). */
export function suggestionAnswerLabel(
  suggestion: SuggestionSummary,
  response: SuggestionResponse,
): string {
  const { question } = suggestion
  if (response.type === 'choice') {
    return question.type === 'choice'
      ? (question.options.find(o => o.value === response.value)?.label ??
          response.value)
      : response.value
  }
  if (response.type === 'text_input') return response.text
  return String(response.value)
}

/** A follow-up suggestion the user answered. */
export function suggestionTrace(
  suggestion: SuggestionSummary,
  response: SuggestionResponse,
): AnswerTrace {
  return withDetail(
    {
      kind: 'suggestion',
      type: suggestion.question.type,
      question: suggestion.question.message,
      answer: suggestionAnswerLabel(suggestion, response),
      status: 'answered',
    },
    response.type === 'choice' ? response.value : undefined,
  )
}

/** A follow-up suggestion the user turned down. */
export function dismissedTrace(suggestion: SuggestionSummary): AnswerTrace {
  return {
    kind: 'suggestion',
    type: suggestion.question.type,
    question: suggestion.question.message,
    answer: 'No thanks',
    status: 'dismissed',
  }
}
