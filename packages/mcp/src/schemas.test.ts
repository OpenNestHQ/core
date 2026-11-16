import { describe, expect, it } from 'vitest'
import type { ResumeAnswer } from '@opennest/sdk'
import {
  emptyInputSchema,
  respondInputSchema,
  runDslInputSchema,
} from './schemas.js'
import type { RespondAnswer } from './schemas.js'

// Type-level drift check: RespondAnswer must be assignable to the SDK's
// ResumeAnswer without casts, otherwise the build fails.
const assignable = (answer: RespondAnswer): ResumeAnswer => answer
void assignable

describe('respondInputSchema', () => {
  const variants: RespondAnswer[] = [
    { type: 'device_selection', deviceId: 'tv_salon' },
    { type: 'confirmation', confirmed: true },
    { type: 'text_input', text: 'hello' },
    { type: 'number_input', value: 42 },
    { type: 'choice', value: 'a' },
    { type: 'action_parameter', values: { volume: '20' } },
  ]

  it.each(variants)('accepts the $type variant', response => {
    expect(respondInputSchema.parse({ response })).toEqual({ response })
  })

  it('rejects an unknown variant', () => {
    expect(
      respondInputSchema.safeParse({ response: { type: 'nope' } }).success,
    ).toBe(false)
  })

  it('rejects a missing field', () => {
    expect(
      respondInputSchema.safeParse({ response: { type: 'device_selection' } })
        .success,
    ).toBe(false)
  })

  it('does not accept or require an interactionId', () => {
    const parsed = respondInputSchema.parse({
      response: { type: 'confirmation', confirmed: true, interactionId: 'x' },
    })
    expect(parsed.response).not.toHaveProperty('interactionId')
  })
})

describe('runDslInputSchema', () => {
  it('accepts { dsl }', () => {
    expect(runDslInputSchema.safeParse({ dsl: 'tv.power = on' }).success).toBe(
      true,
    )
  })

  it('accepts { dsl, dryRun }', () => {
    expect(
      runDslInputSchema.safeParse({ dsl: 'tv.power = on', dryRun: true })
        .success,
    ).toBe(true)
  })

  it('rejects {} and a non-string dsl', () => {
    expect(runDslInputSchema.safeParse({}).success).toBe(false)
    expect(runDslInputSchema.safeParse({ dsl: 42 }).success).toBe(false)
  })
})

describe('emptyInputSchema', () => {
  it('accepts {}', () => {
    expect(emptyInputSchema.safeParse({}).success).toBe(true)
  })
})
