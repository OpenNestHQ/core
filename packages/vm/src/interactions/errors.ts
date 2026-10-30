export type InteractionErrorCode =
  | 'no_session'
  | 'no_pending_program'
  | 'no_pending_interaction'
  | 'interaction_id_mismatch'
  | 'interaction_type_mismatch'
  | 'unknown_device_id'

export class InteractionError extends Error {
  readonly code: InteractionErrorCode
  constructor(code: InteractionErrorCode, message: string) {
    super(message)
    this.name = 'InteractionError'
    this.code = code
  }
}
