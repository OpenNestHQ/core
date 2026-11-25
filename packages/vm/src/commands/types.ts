import type { Action, Program, Statement } from '@opennest/lang-core'
import type { UserResponse } from '../interactions/types.js'
import type { SuggestionResponse } from '../suggestions/types.js'

export interface RunProgramCommand {
  kind: 'run_program'
  program: Program
}

export interface ExecuteActionCommand {
  kind: 'execute_action'
  action: Action
  deviceId?: string
}

export interface ExecuteStatementCommand {
  kind: 'execute_statement'
  statement: Statement
  deviceId?: string
}

export interface ResumeInteractionCommand {
  kind: 'resume_interaction'
  response: UserResponse
}

export interface CancelExecutionCommand {
  kind: 'cancel_execution'
}

/** Answers an open suggestion: runs its follow-up as a new, middleware-gated execution. */
export interface AnswerSuggestionCommand {
  kind: 'answer_suggestion'
  suggestionId: string
  response: SuggestionResponse
}

export type VMCommand =
  | RunProgramCommand
  | ExecuteActionCommand
  | ExecuteStatementCommand
  | ResumeInteractionCommand
  | CancelExecutionCommand
  | AnswerSuggestionCommand
