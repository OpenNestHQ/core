import type { UserInteraction } from '@opennest/sdk'

/** AG-UI interrupt `reason` for each VM interaction type. */
export const REASONS = {
  device_selection: 'opennest:device_selection',
  confirmation: 'confirmation',
  choice: 'opennest:choice',
  text_input: 'opennest:text_input',
  number_input: 'opennest:number_input',
  action_parameter: 'opennest:action_parameter',
} as const satisfies Record<UserInteraction['type'], string>

/** `Interrupt.metadata` of an OpenNest interrupt. */
export interface InterruptMetadata {
  interaction: UserInteraction
  /** Why the previous answer was rejected, when re-asking. */
  error?: string
}

/**
 * `resume[].payload` shapes, per interaction type:
 * - device_selection `{ deviceId }`
 * - confirmation `{ approved }`
 * - choice `{ value }`
 * - text_input `{ value: string }`
 * - number_input `{ value: number }`
 * - action_parameter `{ values: Record<string, string | number | boolean> }`
 */
export type ResumePayload =
  | { deviceId: string }
  | { approved: boolean }
  | { value: string | number }
  | { values: Record<string, string | number | boolean> }
