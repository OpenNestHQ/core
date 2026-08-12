import type { Session } from '../types.js'

// ──── Interaction discriminated union ────

export interface DeviceSelectionDevice {
  id: string
  name: string
  type: string
  room: string
}

export interface DeviceSelectionInteraction {
  id: string
  type: 'device_selection'
  message: string
  devices: DeviceSelectionDevice[]
}

export interface ConfirmationInteraction {
  id: string
  type: 'confirmation'
  message: string
}

export interface TextInputInteraction {
  id: string
  type: 'text_input'
  message: string
  placeholder?: string
}

export interface NumberInputInteraction {
  id: string
  type: 'number_input'
  message: string
  min?: number
  max?: number
}

export interface ChoiceInteraction {
  id: string
  type: 'choice'
  message: string
  options: { value: string; label: string }[]
}

export type UserInteraction =
  | DeviceSelectionInteraction
  | ConfirmationInteraction
  | TextInputInteraction
  | NumberInputInteraction
  | ChoiceInteraction

// ──── Response discriminated union ────

export interface DeviceSelectionResponse {
  interactionId: string
  type: 'device_selection'
  deviceId: string
}

export interface ConfirmationResponse {
  interactionId: string
  type: 'confirmation'
  confirmed: boolean
}

export interface TextInputResponse {
  interactionId: string
  type: 'text_input'
  text: string
}

export interface NumberInputResponse {
  interactionId: string
  type: 'number_input'
  value: number
}

export interface ChoiceResponse {
  interactionId: string
  type: 'choice'
  value: string
}

export type UserResponse =
  | DeviceSelectionResponse
  | ConfirmationResponse
  | TextInputResponse
  | NumberInputResponse
  | ChoiceResponse

// ──── Handler interface ────

export interface InteractionHandler<TContext = unknown> {
  type: string
  createInteraction(context: TContext): UserInteraction
  processResponse(
    session: Session,
    context: TContext,
    response: UserResponse,
  ): void
}

// ──── Pending state (stored in session) ────

export interface PendingInteraction {
  id: string
  type: string
  context: unknown
}
