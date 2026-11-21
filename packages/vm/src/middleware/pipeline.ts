import { Cause, Effect, Exit, Option } from 'effect'
import type { Device, Session } from '../types.js'
import type { Middleware, PlannedAction, PipelineOutcome } from './types.js'
import { BlockSignal, SkipSignal, PauseSignal, ExpandSignal } from './types.js'
import type { VMEventBus } from '../trace/event-bus.js'
import { MiddlewareError } from '../effect/errors.js'
import { runPromiseRethrowingOriginal } from '../effect/run.js'

export interface PipelineEnvironment {
  session: Session
  devices: Device[]
}

type PipelineEffect = Effect.Effect<PipelineOutcome, MiddlewareError>

export function runMiddlewarePipelineEffect(
  action: PlannedAction,
  middlewares: readonly Middleware[],
  env: PipelineEnvironment,
  eventBus?: VMEventBus,
): PipelineEffect {
  return evaluateAt(action, middlewares, env, 0, eventBus)
}

/** Promise façade of {@link runMiddlewarePipelineEffect}; rejects with the middleware's original error. */
export function runMiddlewarePipeline(
  action: PlannedAction,
  middlewares: readonly Middleware[],
  env: PipelineEnvironment,
  eventBus?: VMEventBus,
): Promise<PipelineOutcome> {
  return runPromiseRethrowingOriginal(
    runMiddlewarePipelineEffect(action, middlewares, env, eventBus),
  )
}

function evaluateAt(
  action: PlannedAction,
  middlewares: readonly Middleware[],
  env: PipelineEnvironment,
  index: number,
  eventBus?: VMEventBus,
): PipelineEffect {
  return Effect.suspend(() => {
    if (index >= middlewares.length) {
      return Effect.succeed<PipelineOutcome>({
        kind: 'execute',
        actions: [action],
      })
    }

    const middleware = middlewares[index]!
    const name = getMiddlewareName(middleware)
    const ctx = { action, session: env.session, devices: env.devices }

    eventBus?.emit({
      kind: 'middleware:begin',
      timestamp: Date.now(),
      name,
      actionKind: action.kind,
      deviceId: action.device.id,
    })

    // A later middleware's failure reaches this one as a rejected `next()`;
    // remember it so that a rethrow keeps blaming the middleware that threw.
    let downstreamFailure: MiddlewareError | undefined
    const next =
      (signal: AbortSignal) => async (): Promise<PipelineOutcome> => {
        const exit = await Effect.runPromiseExit(
          evaluateAt(ctx.action, middlewares, env, index + 1, eventBus),
          { signal },
        )
        if (Exit.isSuccess(exit)) return exit.value
        const failure = Cause.findErrorOption(exit.cause)
        if (Option.isSome(failure)) {
          downstreamFailure = failure.value
          throw failure.value.cause
        }
        throw Cause.squash(exit.cause)
      }

    const attempt = Effect.tryPromise({
      try: signal => middleware(ctx, next(signal)),
      catch: thrown => thrown,
    })

    return attempt.pipe(
      Effect.matchEffect({
        onSuccess: outcome => {
          const named =
            outcome.kind === 'blocked' && outcome.middlewareName === ''
              ? { ...outcome, middlewareName: name }
              : outcome
          eventBus?.emit({
            kind: 'middleware:end',
            timestamp: Date.now(),
            status: mapOutcomeStatus(named),
            decision: named.kind,
            ...('reason' in named &&
            (named as { reason?: string }).reason !== undefined
              ? { reason: (named as { reason: string }).reason }
              : {}),
          })
          return Effect.succeed(named)
        },
        onFailure: thrown => {
          const handled = handleThrown(
            thrown,
            name,
            middlewares,
            env,
            index,
            eventBus,
          )
          if (handled) return handled
          return Effect.fail(
            downstreamFailure !== undefined &&
              downstreamFailure.cause === thrown
              ? downstreamFailure
              : new MiddlewareError({ middlewareName: name, cause: thrown }),
          )
        },
      }),
    )
  })
}

/** Maps a flow-control signal to its outcome; `undefined` when `thrown` is not a signal. */
function handleThrown(
  signal: unknown,
  name: string,
  middlewares: readonly Middleware[],
  env: PipelineEnvironment,
  index: number,
  eventBus?: VMEventBus,
): PipelineEffect | undefined {
  if (signal instanceof BlockSignal) {
    eventBus?.emit({
      kind: 'middleware:end',
      timestamp: Date.now(),
      status: 'failed',
      decision: 'block',
      reason: signal.reason,
    })
    return Effect.succeed({
      kind: 'blocked',
      middlewareName: name,
      reason: signal.reason,
    })
  }

  if (signal instanceof SkipSignal) {
    eventBus?.emit({
      kind: 'middleware:end',
      timestamp: Date.now(),
      status: 'skipped',
      decision: 'skip',
      ...(signal.reason !== undefined ? { reason: signal.reason } : {}),
    })
    return Effect.succeed({
      kind: 'skipped',
      ...(signal.reason !== undefined ? { reason: signal.reason } : {}),
    })
  }

  if (signal instanceof PauseSignal) {
    eventBus?.emit({
      kind: 'middleware:end',
      timestamp: Date.now(),
      status: 'waiting',
      decision: 'pause',
    })
    return Effect.succeed({
      kind: 'paused',
      interaction: signal.interaction,
      ...(signal.context !== undefined ? { context: signal.context } : {}),
    })
  }

  if (signal instanceof ExpandSignal) {
    const expand = signal
    return Effect.gen(function* () {
      eventBus?.emit({
        kind: 'middleware:end',
        timestamp: Date.now(),
        status: 'success',
        decision: 'expand',
      })

      const approved: PlannedAction[] = []
      for (const expanded of expand.actions) {
        const result = yield* evaluateAt(
          expanded,
          middlewares,
          env,
          index + 1,
          eventBus,
        )

        if (result.kind === 'execute') {
          approved.push(...result.actions)
        } else if (result.kind === 'skipped') {
          continue
        } else {
          return result
        }
      }

      return { kind: 'execute', actions: approved } satisfies PipelineOutcome
    })
  }

  return undefined
}

function getMiddlewareName(mw: Middleware): string {
  if ('name' in mw && typeof (mw as { name: unknown }).name === 'string') {
    return (mw as { name: string }).name
  }
  return 'anonymous'
}

function mapOutcomeStatus(
  outcome: PipelineOutcome,
): 'success' | 'failed' | 'waiting' | 'skipped' {
  switch (outcome.kind) {
    case 'execute':
      return 'success'
    case 'blocked':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'paused':
      return 'waiting'
  }
}
