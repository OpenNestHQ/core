import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'
import { parseHomeDSL } from '@opennest/lang-core'
import type { Value } from '@opennest/lang-core'
import { MockDriver } from '@opennest/devices'
import type { DriverRuntimeContext } from '@opennest/devices'
import {
  executeCommand,
  createSession,
  createConfirmationMiddleware,
  defineSuggestion,
} from '../index.js'
import { runCommand } from '../effect/index.js'
import type {
  Device,
  Middleware,
  PlannedAction,
  SuggestionApply,
  SuggestionQuestion,
  SuggestionResponse,
  UserResponse,
  VMContext,
} from '../index.js'

interface Write {
  deviceId: string
  property: string
  value: unknown
  programId: string | undefined
}

class RecordingDriver extends MockDriver {
  writes: Write[] = []

  override setProperty(
    deviceId: string,
    property: string,
    value: unknown,
    deviceConfig?: Record<string, unknown>,
    runtime?: DriverRuntimeContext,
  ): Promise<void> {
    this.writes.push({
      deviceId,
      property,
      value,
      programId: runtime?.programId,
    })
    return super.setProperty(deviceId, property, value, deviceConfig, runtime)
  }
}

function makeDevice(
  driver: RecordingDriver,
  id: string,
  type: string,
  initialState: Record<string, unknown>,
): Device {
  driver.seed(id, initialState)
  return { id, type, room: 'living_room', name: id, driver, driverConfig: {} }
}

function parse(code: string) {
  const result = parseHomeDSL(code)
  if (result.errors.length > 0) {
    throw new Error(result.errors.map(e => e.message).join(', '))
  }
  return result.program
}

const num = (value: number): Value => ({ kind: 'number', value })

let counter = 0
function uniqueName(): string {
  return `answer_suggestion_${++counter}`
}

const ambianceQ: SuggestionQuestion = {
  key: 'ambiance',
  type: 'choice',
  message: 'Which ambiance?',
  options: [
    { value: 'cinema', label: 'Cinema' },
    { value: 'reading', label: 'Reading' },
  ],
}

const brightnessFor: Record<string, number> = { cinema: 20, reading: 80 }

const setBrightness: SuggestionApply = (answer, devices) =>
  devices.map(device => ({
    kind: 'set_property',
    device,
    property: 'brightness',
    value: num(brightnessFor[answer as string] ?? 50),
  }))

const isPowerOn = (action: PlannedAction) =>
  action.kind === 'set_property' && action.property === 'power'

/** A middleware offering `question` (default: ambiance) on light power writes. */
function offering(
  apply: SuggestionApply = setBrightness,
  question: SuggestionQuestion = ambianceQ,
  when: (action: PlannedAction) => boolean = isPowerOn,
) {
  const def = defineSuggestion(uniqueName(), { apply })
  const mw: Middleware = async (ctx, next) => {
    if (when(ctx.action)) def.suggest(ctx, question)
    return next()
  }
  return { def, mw }
}

function harness(middleware: Middleware[]) {
  const driver = new RecordingDriver()
  const devices = [
    makeDevice(driver, 'light_1', 'light', { power: false, brightness: 100 }),
    makeDevice(driver, 'light_2', 'light', { power: false, brightness: 100 }),
  ]
  const session = createSession()
  const context = (overrides: Partial<VMContext> = {}): VMContext => ({
    devices,
    session,
    middleware,
    ...overrides,
  })
  return {
    driver,
    devices,
    session,
    context,
    run: (code: string) =>
      executeCommand({ kind: 'run_program', program: parse(code) }, context()),
    answer: (
      suggestionId: string,
      response: SuggestionResponse,
      overrides: Partial<VMContext> = {},
    ) =>
      executeCommand(
        { kind: 'answer_suggestion', suggestionId, response },
        context(overrides),
      ),
    resume: (response: UserResponse) =>
      executeCommand({ kind: 'resume_interaction', response }, context()),
  }
}

const ALL_ON = '$l = @all(light[living_room])\n$l.power = on'
const cinema: SuggestionResponse = { type: 'choice', value: 'cinema' }

describe('answer_suggestion', () => {
  it('runs the chosen follow-up on the targeted devices', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const id = first.suggestions![0]!.id
    const before = h.session.history.length

    const result = await h.answer(id, cinema)

    expect(result.status).toBe('success')
    expect(await h.driver.getProperty('light_1', 'brightness')).toBe(20)
    expect(await h.driver.getProperty('light_2', 'brightness')).toBe(20)
    const added = h.session.history.slice(before)
    expect(added).toHaveLength(1)
    expect(added[0]!.origin).toEqual({ suggestionId: id })
    expect(added[0]!.resolvedDevices.map(d => d.id)).toEqual([
      'light_1',
      'light_2',
    ])
    const stmt = added[0]!.statement
    expect(stmt.kind).toBe('assignment')
    if (stmt.kind !== 'assignment') throw new Error('unreachable')
    expect(stmt.path.map(s => s.identifier)).toEqual(['light', 'brightness'])
    expect(stmt.value).toEqual(num(20))
    expect(added[0]!.outcomes?.map(o => o.execution.status)).toEqual([
      'accepted',
      'accepted',
    ])
    expect(h.session.suggestions ?? []).toEqual([])
    expect(result.suggestions).toBeUndefined()
    expect(h.session._pendingFollowUp).toBeUndefined()
    expect(h.session.cursor).toBe(0)
  })

  it('renews programId for the follow-up', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const runId = h.session.programId

    await h.answer(first.suggestions![0]!.id, cinema)

    expect(h.session.programId).not.toBe(runId)
    const followUpWrites = h.driver.writes.filter(
      w => w.property === 'brightness',
    )
    expect(followUpWrites).toHaveLength(2)
    for (const w of followUpWrites) {
      expect(w.programId).toBe(h.session.programId)
    }
  })

  it('rejects an answer after a new command', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const staleId = first.suggestions![0]!.id
    await h.run('$l = @all(light[living_room])\n$l.power = off')
    const writes = h.driver.writes.length

    const result = await h.answer(staleId, cinema)

    expect(result.status).toBe('error')
    expect(result.errors[0]!.code).toBe('suggestion_not_found')
    expect(result.executed).toEqual([])
    expect(h.driver.writes).toHaveLength(writes)
  })

  it('rejects invalid, mismatched and unavailable answers without executing', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const suggestion = first.suggestions![0]!
    const writes = h.driver.writes.length
    const programId = h.session.programId

    const invalid = await h.answer(suggestion.id, {
      type: 'choice',
      value: 'disco',
    })
    expect(invalid.status).toBe('error')
    expect(invalid.errors[0]!.code).toBe('invalid_response')
    expect(invalid.errors[0]!.message).toContain('"cinema"')

    const mismatch = await h.answer(suggestion.id, {
      type: 'number_input',
      value: 3,
    })
    expect(mismatch.status).toBe('error')
    expect(mismatch.errors[0]!.code).toBe('interaction_type_mismatch')

    expect(h.session.suggestions).toEqual([suggestion])
    expect(h.session.programId).toBe(programId)
    expect(h.driver.writes).toHaveLength(writes)

    h.session.suggestions = [
      { ...suggestion, id: 'suggestion_orphan', name: 'never.defined' },
    ]
    const unavailable = await h.answer('suggestion_orphan', cinema)
    expect(unavailable.status).toBe('error')
    expect(unavailable.errors[0]!.code).toBe('suggestion_unavailable')
    expect(h.session.suggestions).toHaveLength(1)
    expect(h.driver.writes).toHaveLength(writes)
  })

  it('rejects while an interaction is pending', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const suggestion = first.suggestions![0]!
    h.session.pendingInteraction = {
      id: 'confirm_x',
      type: 'confirmation',
      context: null,
    }

    const result = await h.answer(suggestion.id, cinema)

    expect(result.status).toBe('error')
    expect(result.errors[0]!.code).toBe('interaction_pending')
    expect(h.session.suggestions).toEqual([suggestion])
  })

  it('passes the follow-up through middleware', async () => {
    const { mw } = offering(setBrightness, ambianceQ, () => true)
    const guard: Middleware = async (ctx, next) => {
      if (ctx.action.kind === 'set_property') {
        if (ctx.action.property === 'brightness') {
          return { kind: 'blocked', reason: 'no dimming', middlewareName: 'g' }
        }
      }
      return next()
    }
    const h = harness([mw, guard])
    const first = await h.run(ALL_ON)
    const writes = h.driver.writes.length

    const result = await h.answer(first.suggestions![0]!.id, cinema)

    expect(result.status).toBe('error')
    expect(result.errors[0]!.message).toContain('no dimming')
    expect(h.driver.writes).toHaveLength(writes)
    expect(result.suggestions).toBeUndefined()
    expect(h.session.suggestions ?? []).toEqual([])
    expect(h.session._pendingFollowUp).toBeUndefined()
  })

  it('pauses and resumes a follow-up without resending commands', async () => {
    const { mw } = offering()
    const confirm = createConfirmationMiddleware({
      requireConfirmation: a =>
        a.kind === 'set_property' && a.property === 'brightness',
    })
    const h = harness([mw, confirm])
    const first = await h.run(ALL_ON)
    const id = first.suggestions![0]!.id
    const before = h.session.history.length

    const paused = await h.answer(id, cinema)
    expect(paused.status).toBe('awaiting_interaction')
    expect(paused.interaction!.type).toBe('confirmation')
    expect(h.session._pendingFollowUp?.suggestionId).toBe(id)
    expect(h.driver.writes.filter(w => w.property === 'brightness')).toEqual([])

    let result = await h.resume({
      interactionId: paused.interaction!.id,
      type: 'confirmation',
      confirmed: true,
    })
    // One confirmation per device.
    if (result.status === 'awaiting_interaction') {
      result = await h.resume({
        interactionId: result.interaction!.id,
        type: 'confirmation',
        confirmed: true,
      })
    }

    expect(result.status).toBe('success')
    const brightness = h.driver.writes.filter(w => w.property === 'brightness')
    expect(brightness.map(w => w.deviceId).sort()).toEqual([
      'light_1',
      'light_2',
    ])
    const added = h.session.history.slice(before)
    expect(added).toHaveLength(1)
    expect(added[0]!.origin).toEqual({ suggestionId: id })
    expect(h.session._pendingFollowUp).toBeUndefined()
    expect(h.session.cursor).toBe(0)
  })

  it("keeps siblings and adds the follow-up's suggestions", async () => {
    const a = offering()
    const b = offering(setBrightness, { ...ambianceQ, key: 'other' })
    const c = offering(
      () => [],
      { ...ambianceQ, key: 'chained' },
      action =>
        action.kind === 'set_property' && action.property === 'brightness',
    )
    const h = harness([a.mw, b.mw, c.mw])
    const first = await h.run(ALL_ON)
    expect(first.suggestions).toHaveLength(2)
    const [sa, sb] = first.suggestions!
    expect(sa!.name).toBe(a.def.name)

    const result = await h.answer(sa!.id, cinema)

    expect(result.status).toBe('success')
    expect(result.suggestions?.map(s => s.name)).toEqual([
      b.def.name,
      c.def.name,
    ])
    expect(result.suggestions![0]).toEqual(sb)
    expect(result.suggestions![1]!.targets).toEqual(['light_1', 'light_2'])
    expect(h.session.suggestions).toEqual(result.suggestions)

    const sibling = await h.answer(sb!.id, {
      type: 'choice',
      value: 'reading',
    })
    expect(sibling.status).toBe('success')
    expect(await h.driver.getProperty('light_1', 'brightness')).toBe(80)
  })

  it('drops target devices that no longer exist', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const before = h.session.history.length

    const result = await h.answer(first.suggestions![0]!.id, cinema, {
      devices: [h.devices[0]!],
    })

    expect(result.status).toBe('success')
    expect(await h.driver.getProperty('light_1', 'brightness')).toBe(20)
    expect(await h.driver.getProperty('light_2', 'brightness')).toBe(100)
    expect(
      h.session.history.slice(before)[0]!.resolvedDevices.map(d => d.id),
    ).toEqual(['light_1'])
  })

  it('succeeds with nothing executed when apply returns []', async () => {
    const { mw } = offering(() => [])
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const before = h.session.history.length
    const writes = h.driver.writes.length

    const result = await h.answer(first.suggestions![0]!.id, cinema)

    expect(result.status).toBe('success')
    expect(result.errors).toEqual([])
    expect(h.session.history).toHaveLength(before)
    expect(h.driver.writes).toHaveLength(writes)
    expect(h.session.suggestions).toBeUndefined()
  })

  it('removes session.suggestions once the last one is answered', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    expect(h.session.suggestions).toHaveLength(1)

    await h.answer(first.suggestions![0]!.id, cinema)

    expect(h.session.suggestions).toBeUndefined()
    expect('suggestions' in h.session).toBe(false)
  })

  it('keeps the same operation on one device as separate steps', async () => {
    const { mw } = offering((_answer, devices) => [
      {
        kind: 'increment_property' as const,
        device: devices[0]!,
        property: 'brightness',
        value: num(5),
      },
      {
        kind: 'increment_property' as const,
        device: devices[0]!,
        property: 'brightness',
        value: num(5),
      },
    ])
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const before = h.session.history.length

    const result = await h.answer(first.suggestions![0]!.id, cinema)

    expect(result.status).toBe('success')
    expect(h.session.history.slice(before)).toHaveLength(2)
    expect(await h.driver.getProperty('light_1', 'brightness')).toBe(110)
  })

  it('rejects the façade with the original error when apply throws', async () => {
    const boom = new Error('apply failed')
    const { mw } = offering(() => {
      throw boom
    })
    const h = harness([mw])
    const first = await h.run(ALL_ON)

    await expect(h.answer(first.suggestions![0]!.id, cinema)).rejects.toBe(boom)
    expect(h.session.suggestions ?? []).toEqual([])
    expect(h.session._pendingFollowUp).toBeUndefined()
    expect(h.session.cursor).toBe(0)
  })

  it('rejects read_property actions and unknown devices returned by apply', async () => {
    const stranger: Device = {
      id: 'ghost',
      type: 'light',
      room: 'living_room',
      name: 'ghost',
      driver: new RecordingDriver(),
      driverConfig: {},
    }
    const read = offering((_answer, devices) => [
      { kind: 'read_property', device: devices[0]!, property: 'power' },
    ])
    const ghost = offering(() => [
      {
        kind: 'set_property',
        device: stranger,
        property: 'power',
        value: { kind: 'power', value: 'on' },
      },
    ])
    for (const [{ mw }, message] of [
      [read, /unsupported action kind "read_property"/],
      [ghost, /unknown device "ghost"/],
    ] as const) {
      const h = harness([mw])
      const first = await h.run(ALL_ON)
      const writes = h.driver.writes.length

      await expect(h.answer(first.suggestions![0]!.id, cinema)).rejects.toThrow(
        message,
      )
      expect(h.driver.writes).toHaveLength(writes)
      expect(h.session._pendingFollowUp).toBeUndefined()
    }
  })

  it('groups equal operations into one step and keeps distinct ones apart', async () => {
    const { mw } = offering((_answer, devices) => [
      ...devices.map(device => ({
        kind: 'increment_property' as const,
        device,
        property: 'brightness',
        value: num(-10),
      })),
      {
        kind: 'set_property',
        device: devices[0]!,
        property: 'color',
        value: { kind: 'string', value: 'warm' },
      },
      {
        kind: 'set_property',
        device: devices[1]!,
        property: 'color',
        value: { kind: 'string', value: 'cold' },
      },
    ])
    const h = harness([mw])
    const first = await h.run(ALL_ON)
    const before = h.session.history.length

    const result = await h.answer(first.suggestions![0]!.id, cinema)

    expect(result.status).toBe('success')
    const added = h.session.history.slice(before)
    expect(added.map(e => e.statement.kind)).toEqual([
      'increment',
      'assignment',
      'assignment',
    ])
    expect(added.map(e => e.resolvedDevices.map(d => d.id))).toEqual([
      ['light_1', 'light_2'],
      ['light_1'],
      ['light_2'],
    ])
    expect(await h.driver.getProperty('light_2', 'brightness')).toBe(90)
    expect(await h.driver.getProperty('light_2', 'color')).toBe('cold')
  })

  it('never resumes a follow-up left over by a throwing middleware', async () => {
    const { mw } = offering()
    const boom = new Error('middleware crashed')
    const crash: Middleware = async (ctx, next) => {
      if (
        ctx.action.kind === 'set_property' &&
        ctx.action.property === 'brightness'
      ) {
        throw boom
      }
      return next()
    }
    let armed = false
    const confirm = createConfirmationMiddleware({
      requireConfirmation: () => armed,
    })
    const h = harness([mw, crash, confirm])
    const first = await h.run(ALL_ON)

    await expect(h.answer(first.suggestions![0]!.id, cinema)).rejects.toBe(boom)
    expect(h.session._pendingFollowUp).toBeUndefined()
    expect(h.session.cursor).toBe(0)

    armed = true
    const paused = await h.run(
      '$l = @first(light[living_room])\n$l.power = off',
    )
    expect(paused.status).toBe('awaiting_interaction')
    const before = h.session.history.length

    const result = await h.resume({
      interactionId: paused.interaction!.id,
      type: 'confirmation',
      confirmed: true,
    })

    expect(result.status).toBe('success')
    expect(await h.driver.getProperty('light_1', 'power')).toBe(false)
    const added = h.session.history.slice(before)
    expect(added).toHaveLength(1)
    expect(added[0]!.origin).toBeUndefined()
    expect(added[0]!.statement.kind).toBe('assignment')
  })

  it('drops a stale pending follow-up when a new program starts', async () => {
    const confirm = createConfirmationMiddleware({
      requireConfirmation: () => true,
    })
    const h = harness([confirm])
    h.session._pendingFollowUp = {
      suggestionId: 'suggestion_stale',
      steps: [
        {
          kind: 'set_property',
          deviceIds: ['light_2'],
          property: 'brightness',
          value: num(1),
        },
      ],
    }

    const paused = await h.run('$l = @first(light[living_room])\n$l.power = on')
    expect(paused.status).toBe('awaiting_interaction')
    expect(h.session._pendingFollowUp).toBeUndefined()

    const result = await h.resume({
      interactionId: paused.interaction!.id,
      type: 'confirmation',
      confirmed: true,
    })

    expect(result.status).toBe('success')
    expect(h.driver.writes.map(w => [w.deviceId, w.property])).toEqual([
      ['light_1', 'power'],
    ])
  })

  it('works through runCommand', async () => {
    const { mw } = offering()
    const h = harness([mw])
    const first = await h.run(ALL_ON)

    const result = await Effect.runPromise(
      runCommand(
        {
          kind: 'answer_suggestion',
          suggestionId: first.suggestions![0]!.id,
          response: cinema,
        },
        h.context(),
      ),
    )

    expect(result.status).toBe('success')
    expect(await h.driver.getProperty('light_2', 'brightness')).toBe(20)
  })
})
