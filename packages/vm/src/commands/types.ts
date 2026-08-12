import type { Action, Program, Statement } from '@opennest/lang-core'
import type { UserResponse } from '../interactions/types.js'

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

export type VMCommand =
  | RunProgramCommand
  | ExecuteActionCommand
  | ExecuteStatementCommand
  | ResumeInteractionCommand
  | CancelExecutionCommand
