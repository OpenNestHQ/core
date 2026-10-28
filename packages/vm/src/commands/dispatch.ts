import type { Program } from '@opennest/lang-core'
import { buildProgram } from '@opennest/lang-core'
import { createSession } from '../state.js'
import { resumeAndContinue } from '../state.js'
import { InteractionError } from '../interactions/errors.js'
import type { VMContext, VMResult } from '../types.js'
import type { VMCommand } from './types.js'
import { interpretProgram } from '../interpreter.js'

export async function executeCommand(
  command: VMCommand,
  context: VMContext,
): Promise<VMResult> {
  switch (command.kind) {
    case 'run_program':
      return runProgram(command.program, context)
    case 'execute_action':
      return runProgram(
        buildProgram([command.action]),
        context,
        command.deviceId,
      )
    case 'execute_statement':
      return runProgram(
        buildProgram([command.statement]),
        context,
        command.deviceId,
      )
    case 'resume_interaction':
      try {
        return await resumeAndContinue(command.response, context)
      } catch (error) {
        if (error instanceof InteractionError) {
          return {
            status: 'error',
            session: context.session ?? createSession(),
            executed: [],
            interaction: null,
            errors: [{ code: error.code, message: error.message }],
          }
        }
        throw error
      }
    case 'cancel_execution':
      return {
        status: 'success',
        session: createSession(),
        executed: [],
        interaction: null,
        errors: [],
      }
  }
}

async function runProgram(
  program: Program,
  context: VMContext,
  deviceId?: string,
): Promise<VMResult> {
  return interpretProgram(
    program,
    deviceId !== undefined
      ? context.devices.filter(d => d.id === deviceId)
      : context.devices,
    context.session,
    context.middleware,
    context.eventBus,
  )
}
