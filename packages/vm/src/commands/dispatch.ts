import { Effect } from 'effect'
import type { Program } from '@opennest/lang-core'
import { buildProgram } from '@opennest/lang-core'
import { createSession, resumeAndContinueEffect } from '../state.js'
import { InteractionError } from '../interactions/errors.js'
import type { VMContext, VMResult } from '../types.js'
import type { VMCommand } from './types.js'
import type { VMInfraError } from '../effect/errors.js'
import { runPromiseRethrowingOriginal } from '../effect/run.js'
import { makeStopToken, neverStop, toVMResult } from '../effect/stop.js'
import type { EffectVMResult, StopToken } from '../effect/stop.js'
import { interpretProgramEffect } from '../interpreter.js'

export interface RunOptions {
  /**
   * Requests a cooperative stop when it completes: nothing new is sent, sent
   * writes complete, reads and verifications are abandoned, and the result is
   * `interrupted` with what was executed. No effect once the run has ended
   * (including on `awaiting_interaction`).
   */
  stop?: Effect.Effect<void>
}

/**
 * Runs a VM command. Business outcomes, including failed resume
 * preconditions, are an error `VMResult`; only infrastructure failures that
 * abort the run are in the error channel.
 */
export function runCommand(
  command: VMCommand,
  context: VMContext,
  options: RunOptions = {},
): Effect.Effect<EffectVMResult, VMInfraError> {
  const { stop } = options
  if (stop === undefined) return dispatch(command, context, neverStop)
  return Effect.scoped(
    Effect.flatMap(makeStopToken(stop), token =>
      dispatch(command, context, token),
    ),
  )
}

function dispatch(
  command: VMCommand,
  context: VMContext,
  stop: StopToken,
): Effect.Effect<EffectVMResult, VMInfraError> {
  switch (command.kind) {
    case 'run_program':
      return runProgram(command.program, context, stop)
    case 'execute_action':
      return runProgram(
        buildProgram([command.action]),
        context,
        stop,
        command.deviceId,
      )
    case 'execute_statement':
      return runProgram(
        buildProgram([command.statement]),
        context,
        stop,
        command.deviceId,
      )
    case 'resume_interaction':
      return resumeAndContinueEffect(command.response, context, stop).pipe(
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
  return runPromiseRethrowingOriginal(
    runCommand(command, context).pipe(Effect.map(toVMResult)),
  )
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
  stop: StopToken,
  deviceId?: string,
): Effect.Effect<EffectVMResult, VMInfraError> {
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

    // Each new program is its own run: later features key data by programId.
    if (context.session !== undefined) {
      context.session.programId = crypto.randomUUID()
    }

    return interpretProgramEffect(
      program,
      deviceId !== undefined
        ? context.devices.filter(d => d.id === deviceId)
        : context.devices,
      context.session,
      context.middleware,
      context.eventBus,
      stop,
    )
  })
}
