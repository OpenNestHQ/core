import { z } from 'zod'

/** AG-UI `activityType` of the chat trace left by an answered question. */
export const ANSWER_ACTIVITY = 'opennest-answer'

/**
 * One answered VM question (`ask`, device choice, confirmation...) or follow-up
 * suggestion, kept in the chat as an activity message. Activity messages never
 * go back to the model.
 */
export const answerTraceSchema = z.object({
  kind: z.enum(['question', 'suggestion']),
  /** VM interaction type, or the suggestion question type. */
  type: z.string(),
  question: z.string(),
  /** Plain-language answer ("Living Room TV", "Yes", "••••"). */
  answer: z.string(),
  /** Technical form of the answer for Advanced mode (device id, value). */
  detail: z.string().optional(),
  status: z.enum(['answered', 'cancelled', 'dismissed']),
})

export type AnswerTrace = z.infer<typeof answerTraceSchema>
