import { z } from 'zod'

export const runDslInputSchema = z.object({
  dsl: z.string().describe('HomeDSL program to run.'),
  dryRun: z
    .boolean()
    .optional()
    .describe(
      'When true, only parse and validate the program; nothing is executed.',
    ),
})

/**
 * Mirror of the core `UserResponse` minus `interactionId`: the runtime
 * auto-targets the pending interaction, so agents never see or send an id.
 */
export const respondResponseSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('device_selection'),
    deviceId: z.string().describe('The `choices[].id` of the chosen device.'),
  }),
  z.object({
    type: z.literal('confirmation'),
    confirmed: z
      .boolean()
      .describe('true to approve the pending action, false to refuse.'),
  }),
  z.object({
    type: z.literal('text_input'),
    text: z.string().describe('The free-form text typed by the user.'),
  }),
  z.object({
    type: z.literal('number_input'),
    value: z.number().describe('The number chosen by the user.'),
  }),
  z.object({
    type: z.literal('choice'),
    value: z.string().describe('The `choices[].id` of the chosen option.'),
  }),
  z.object({
    type: z.literal('action_parameter'),
    values: z
      .record(z.string(), z.string())
      .describe('Value for each missing parameter, keyed by parameter name.'),
  }),
])

export const respondInputSchema = z.object({ response: respondResponseSchema })

export const suggestionAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text_input'),
    text: z.string().describe('The free-form text typed by the user.'),
  }),
  z.object({
    type: z.literal('number_input'),
    value: z.number().describe('The number chosen by the user.'),
  }),
  z.object({
    type: z.literal('choice'),
    value: z.string().describe('The `choices[].id` of the chosen option.'),
  }),
])

export const answerSuggestionInputSchema = z.object({
  suggestionId: z.string().describe('The `id` of the suggestion to answer.'),
  answer: suggestionAnswerSchema,
})

export const emptyInputSchema = z.object({})

export type RunDslInput = { dsl: string; dryRun?: boolean }

export type RespondAnswer =
  | { type: 'device_selection'; deviceId: string }
  | { type: 'confirmation'; confirmed: boolean }
  | { type: 'text_input'; text: string }
  | { type: 'number_input'; value: number }
  | { type: 'choice'; value: string }
  | { type: 'action_parameter'; values: Record<string, string> }

export type SuggestionAnswer =
  | { type: 'text_input'; text: string }
  | { type: 'number_input'; value: number }
  | { type: 'choice'; value: string }

export type AnswerSuggestionInput = {
  suggestionId: string
  answer: SuggestionAnswer
}

export type RespondInput = { response: RespondAnswer }
