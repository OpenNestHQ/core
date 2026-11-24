import { Effect } from 'effect'
import {
  buildAction,
  buildAssignment,
  buildIncrement,
} from '@opennest/lang-core'
import type { Statement, Value } from '@opennest/lang-core'
import type { Device, Session, VMContext } from '../types.js'
import type { PlannedAction } from '../middleware/types.js'
import type { VMInfraError } from '../effect/errors.js'
import type { EffectVMResult, StopToken } from '../effect/stop.js'
import {
  applyMiddlewareAndFinish,
  finishProgram,
  runStatementLoop,
  suspendAt,
  traceStatement,
} from '../interpreter.js'
import type { InterpretResult, InterpreterEnv } from '../interpreter.js'
import { clearSuggestionRun } from './collect.js'
import type { FollowUpStep, PendingFollowUp } from './types.js'

/**
 * Checks the actions returned by `apply` and groups them into steps: actions
 * with the same kind, property/method and value/args make one step over all
 * their devices, in first-seen order. Throws on a `read_property` action or a
 * device that is not in `devices`.
 */
export function buildFollowUpSteps(
  actions: unknown,
  devices: Device[],
): FollowUpStep[] {
  if (!Array.isArray(actions)) {
    throw new Error('Suggestion apply must return an array of PlannedAction')
  }
  const known = new Set(devices.map(d => d.id))
  const steps: { key: string; step: FollowUpStep }[] = []

  for (const action of actions as PlannedAction[]) {
    if (!known.has(action?.device?.id)) {
      throw new Error(
        `Suggestion apply returned an action on unknown device "${String(action?.device?.id)}"`,
      )
    }
    const step = toStep(action)
    const key = stableKey({ ...step, deviceIds: [] })
    const existing = steps.find(s => s.key === key)
    if (existing) {
      if (!existing.step.deviceIds.includes(action.device.id)) {
        existing.step.deviceIds.push(action.device.id)
      }
    } else {
      steps.push({ key, step })
    }
  }
  return steps.map(s => s.step)
}

function toStep(action: PlannedAction): FollowUpStep {
  const deviceIds = [action.device.id]
  switch (action.kind) {
    case 'set_property':
    case 'increment_property':
      return {
        kind: action.kind,
        deviceIds,
        property: action.property,
        value: structuredClone(action.value),
      }
    case 'invoke_action':
      return {
        kind: 'invoke_action',
        deviceIds,
        method: action.method,
        ...(action.args ? { args: structuredClone(action.args) } : {}),
      }
    default:
      throw new Error(
        `Suggestion apply returned an unsupported action kind "${(action as { kind: unknown }).kind as string}"`,
      )
  }
}

/** A key equal for deep-equal plain data, whatever the object key order. */
function stableKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKey(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Runs the pending follow-up of `context.session` from its cursor: each step
 * is a pseudo-statement going through middleware approval, batch execution
 * and recording like a statement's actions, and ends like a program run.
 */
export function runFollowUpEffect(
  context: VMContext,
  session: Session,
  followUp: PendingFollowUp,
  stop: StopToken,
): Effect.Effect<EffectVMResult, VMInfraError> {
  return Effect.gen(function* () {
    const env: InterpreterEnv = {
      devices: context.devices,
      session,
      middleware: context.middleware,
      eventBus: context.eventBus,
      runtime: { programId: session.programId },
      stop,
    }
    const { steps, suggestionId } = followUp

    env.eventBus?.emit({ kind: 'program:begin', timestamp: Date.now() })
    const run = yield* runStatementLoop(
      steps.length,
      env,
      i => runStep(steps[i]!, i, suggestionId, env),
      (i, awaiting) => suspendAt(session, i, awaiting),
    )
    return finishProgram(run, env)
  }).pipe(
    // An infra failure skips `finishProgram`: leave no follow-up to resume.
    Effect.onError(() =>
      Effect.sync(() => {
        delete session._pendingFollowUp
        session.cursor = 0
        session.resolvedIds = {}
        clearSuggestionRun(session)
      }),
    ),
  )
}

function runStep(
  step: FollowUpStep,
  index: number,
  suggestionId: string,
  env: InterpreterEnv,
): Effect.Effect<InterpretResult, VMInfraError> {
  return Effect.suspend(() => {
    const { session } = env
    const devices = step.deviceIds
      .map(id => env.devices.find(d => d.id === id))
      .filter((d): d is Device => d !== undefined)
    // Devices removed since the follow-up started: nothing left to run.
    if (devices.length === 0) {
      return Effect.succeed<InterpretResult>({ kind: 'success' })
    }

    const statement = toStatement(step, devices[0]!.type)
    const actions = devices.map(device => toAction(step, device))
    const recordedFrom = session.history.length
    return traceStatement(
      statement,
      index,
      env,
      applyMiddlewareAndFinish(
        actions,
        statement,
        { devices, ambiguous: false },
        env,
      ),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          for (const entry of session.history.slice(recordedFrom)) {
            entry.origin = { suggestionId }
          }
        }),
      ),
    )
  })
}

function toStatement(step: FollowUpStep, deviceType: string): Statement {
  switch (step.kind) {
    case 'set_property':
      return buildAssignment(deviceType, step.property!, step.value!)
    case 'increment_property':
      return buildIncrement(deviceType, step.property!, step.value!)
    case 'invoke_action':
      return {
        ...buildAction(deviceType, step.method!),
        ...(step.args ? { args: step.args } : {}),
      }
  }
}

function toAction(step: FollowUpStep, device: Device): PlannedAction {
  switch (step.kind) {
    case 'set_property':
    case 'increment_property':
      return {
        kind: step.kind,
        device,
        property: step.property!,
        value: step.value as Value,
      }
    case 'invoke_action':
      return {
        kind: 'invoke_action',
        device,
        method: step.method!,
        ...(step.args ? { args: { ...step.args } } : {}),
      }
  }
}
