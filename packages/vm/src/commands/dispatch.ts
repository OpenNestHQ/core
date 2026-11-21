import { Effect } from 'effect'
import type { Program } from '@opennest/lang-core'
import { buildProgram } from '@opennest/lang-core'
import { createSession, resumeAndContinueEffect } from '../state.js'
import { InteractionError } from '../interactions/errors.js'
import type { VMContext, VMResult } from '../types.js'
import type { VMCommand } from './types.js'
import type { VMInfraError } from '../effect/errors.js'
import { runPromiseRethrowingOriginal } from '../effect/run.js'
import { interpretProgramEffect } from '../interpreter.js'

/**
 * Runs a VM command. Business outcomes, including failed resume
 * preconditions, are an error `VMResult`; only infrastructure failures that
 * abort the run are in the error channel.
 */
export function runCommand(
  command: VMCommand,
  context: VMContext,
): Effect.Effect<VMResult, VMInfraError> {
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
      return resumeAndContinueEffect(command.response, context).pipe(
        Effect.catchIf(
          (error): error is InteractionError =>
            error instanceof InteractionError,
          error => Effect.succeed(interactionErrorResult(error, context)),
        ),
      )
    case 'cancel_execution':
      return Effect.succeed({
        status: 'success',
        session: createSession(),
        executed: [],
        interaction: null,
        errors: [],
      })
  }
}

/** Promise façade of {@link runCommand}; rejects with the original error. */
export function executeCommand(
  command: VMCommand,
  context: VMContext,
): Promise<VMResult> {
  return runPromiseRethrowingOriginal(runCommand(command, context))
}

function interactionErrorResult(
  error: InteractionError,
  context: VMContext,
): VMResult {
  return {
    status: 'error',
    session: context.session ?? createSession(),
    executed: [],
    interaction: null,
    errors: [{ code: error.code, message: error.message }],
  }
}

function runProgram(
  program: Program,
  context: VMContext,
  deviceId?: string,
): Effect.Effect<VMResult, VMInfraError> {
  return Effect.suspend(() => {
    const pending = context.session?.pendingInteraction
    if (pending !== null && pending !== undefined) {
      return Effect.succeed<VMResult>({
        status: 'error',
        session: context.session!,
        executed: [],
        interaction: null,
        errors: [
          {
            code: 'interaction_pending',
            message: `Interaction ${pending.id} (${pending.type}) is pending. Answer it with resume_interaction, or cancel the execution first.`,
          },
        ],
      })
    }

    return interpretProgramEffect(
      program,
      deviceId !== undefined
        ? context.devices.filter(d => d.id === deviceId)
        : context.devices,
      context.session,
      context.middleware,
      context.eventBus,
    )
  })
}
