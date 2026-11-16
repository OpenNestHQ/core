import { z } from 'zod'

export const runDslInputSchema = z.object({
  dsl: z.string(),
  dryRun: z.boolean().optional(),
})

/**
 * Mirror of the core `UserResponse` minus `interactionId`: the runtime
 * auto-targets the pending interaction, so agents never see or send an id.
 */
export const respondResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('device_selection'), deviceId: z.string() }),
  z.object({ type: z.literal('confirmation'), confirmed: z.boolean() }),
  z.object({ type: z.literal('text_input'), text: z.string() }),
  z.object({ type: z.literal('number_input'), value: z.number() }),
  z.object({ type: z.literal('choice'), value: z.string() }),
  z.object({
    type: z.literal('action_parameter'),
    values: z.record(z.string(), z.string()),
  }),
])

export const respondInputSchema = z.object({ response: respondResponseSchema })

export const emptyInputSchema = z.object({})

export type RunDslInput = { dsl: string; dryRun?: boolean }

export type RespondAnswer =
  | { type: 'device_selection'; deviceId: string }
  | { type: 'confirmation'; confirmed: boolean }
  | { type: 'text_input'; text: string }
  | { type: 'number_input'; value: number }
  | { type: 'choice'; value: string }
  | { type: 'action_parameter'; values: Record<string, string> }

export type RespondInput = { response: RespondAnswer }
