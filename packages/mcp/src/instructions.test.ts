import { describe, expect, it } from 'vitest'
import { buildInstructions } from './instructions.js'

describe('buildInstructions', () => {
  const text = buildInstructions('<REF>')

  it('has the four titled sections', () => {
    for (const title of [
      'What this server does',
      'Tool protocol',
      'Error codes',
      'HomeDSL reference',
    ]) {
      expect(text).toContain(title)
    }
  })

  it('embeds the reference verbatim, at the end', () => {
    expect(text).toContain('<REF>')
    expect(text.trimEnd().endsWith('<REF>')).toBe(true)
  })

  it('documents deviceFailures and the choice-id contract', () => {
    expect(text).toContain('deviceFailures')
    expect(text).not.toContain('a device or the runtime failed')
    expect(text).toContain('as `deviceId` for `device_selection`')
    expect(text).toContain('as `value` for `choice`')
  })

  it('lists the main public error codes', () => {
    for (const code of [
      'parse_error',
      'validation_error',
      'execution_failed',
      'interaction_pending',
      'no_pending_interaction',
      'interaction_aborted',
      'core_error',
    ]) {
      expect(text).toContain(code)
    }
  })

  it('documents invalid_response as retryable', () => {
    expect(text).toContain('invalid_response')
    expect(text).toMatch(/invalid_response[^\n]*retr/i)
    expect(text).toMatch(
      /invalid_response[^\n]*`respond`[^\n]*`answer_suggestion`[^\n]*same `suggestionId`/,
    )
  })

  it('documents suggestions and answer_suggestion', () => {
    expect(text).toContain('answer_suggestion')
    expect(text).toMatch(/never required/i)
    expect(text).toMatch(/never answer one on the user's behalf/i)
    expect(text).toMatch(/next `run_dsl` drops all open suggestions/)
    expect(text).toMatch(/`run_dsl` and `answer_suggestion` are `blocked`/)
    expect(text).toMatch(
      /suggestion_unavailable[^\n]*not registered in this runtime/,
    )
    expect(text).not.toMatch(/devices are gone/)
    for (const code of [
      'suggestion_not_found',
      'suggestion_unavailable',
      'suggestion_aborted',
    ]) {
      expect(text).toContain(code)
    }
  })
})
