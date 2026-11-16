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
})
