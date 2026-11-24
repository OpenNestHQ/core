import { describe, it, expect } from 'vitest'
import { parseHomeDSL } from '@opennest/lang-core'
import { MockDriver } from '@opennest/devices'
import {
  executeCommand,
  createSession,
  createAsk,
  defineSuggestion,
} from '../index.js'
import type {
  Device,
  Middleware,
  MiddlewareContext,
  SuggestionQuestion,
  UserResponse,
} from '../index.js'

class FlakyDriver extends MockDriver {
  failFor = new Set<string>()

  override setProperty(
    deviceId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    if (this.failFor.has(deviceId)) {
      return Promise.reject(new Error(`refused ${deviceId}`))
    }
    return super.setProperty(deviceId, property, value)
  }
}

function makeDevice(
  driver: FlakyDriver,
  id: string,
  type: string,
  room: string,
  initialState: Record<string, unknown>,
): Device {
  driver.seed(id, initialState)
  return { id, type, room, name: id, driver, driverConfig: {} }
}

function inventory() {
  const driver = new FlakyDriver()
  const devices = [
    makeDevice(driver, 'light_1', 'light', 'salon', { power: false }),
    makeDevice(driver, 'light_2', 'light', 'salon', { power: false }),
    makeDevice(driver, 'light_3', 'light', 'salon', { power: false }),
    makeDevice(driver, 'tv_salon', 'tv', 'salon', { power: false }),
  ]
  return { driver, devices }
}

function parse(code: string) {
  const result = parseHomeDSL(code)
  if (result.errors.length > 0) {
    throw new Error(result.errors.map(e => e.message).join(', '))
  }
  return result.program
}

function harness(middleware: Middleware[]) {
  const { driver, devices } = inventory()
  const session = createSession()
  const ctx = () => ({ devices, session, middleware })
  return {
    driver,
    devices,
    session,
    run: (code: string) =>
      executeCommand({ kind: 'run_program', program: parse(code) }, ctx()),
    resume: (response: UserResponse) =>
      executeCommand({ kind: 'resume_interaction', response }, ctx()),
    cancel: () => executeCommand({ kind: 'cancel_execution' }, ctx()),
  }
}

const ONE = '$l = @first(light[salon])\n$l.power = on'
const ONE_OFF = '$l = @first(light[salon])\n$l.power = off'
const ALL = '$l = @all(light[salon])\n$l.power = on'

let counter = 0
function uniqueName(): string {
  return `test_suggestion_${++counter}`
}

const choiceQ: SuggestionQuestion = {
  key: 'mode',
  type: 'choice',
  message: 'Which mode?',
  options: [
    { value: 'cinema', label: 'Cinema' },
    { value: 'day', label: 'Day' },
  ],
}

function suggester(
  options: { when?: (ctx: MiddlewareContext) => boolean; data?: unknown } = {},
) {
  const def = defineSuggestion(uniqueName(), { apply: () => [] })
  const mw: Middleware = async (ctx, next) => {
    if (!options.when || options.when(ctx)) {
      def.suggest(ctx, {
        ...choiceQ,
        ...(options.data !== undefined ? { data: options.data as never } : {}),
      })
    }
    return next()
  }
  return { def, mw }
}

function fakeCtx(): MiddlewareContext {
  const { devices } = inventory()
  return {
    action: {
      kind: 'set_property',
      device: devices[0]!,
      property: 'power',
      value: { kind: 'power', value: 'on' },
    },
    session: createSession(),
    devices,
  }
}

describe('suggestions', () => {
  it('opens one suggestion for a successful statement', async () => {
    const { def, mw } = suggester({ data: { room: 'salon' } })
    const h = harness([mw])

    const result = await h.run(ONE)

    expect(result.status).toBe('success')
    expect(result.suggestions).toHaveLength(1)
    const [s] = result.suggestions!
    expect(s!.name).toBe(def.name)
    expect(s!.id).toMatch(/^suggestion_/)
    expect(s!.targets).toEqual(['light_1'])
    expect(s!.question).toEqual(choiceQ)
    expect(s!.data).toEqual({ room: 'salon' })
    expect(h.session.suggestions).toEqual(result.suggestions)
    expect(JSON.parse(JSON.stringify(h.session.suggestions))).toEqual(
      h.session.suggestions,
    )
  })

  it('merges an @all statement into one suggestion', async () => {
    const { mw } = suggester()
    const h = harness([mw])

    const result = await h.run(ALL)

    expect(result.status).toBe('success')
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions![0]!.targets).toEqual([
      'light_1',
      'light_2',
      'light_3',
    ])
  })

  it('targets only devices whose action was accepted', async () => {
    const { def } = suggester()
    const mw: Middleware = async (ctx, next) => {
      def.suggest(ctx, choiceQ)
      if (ctx.action.device.id === 'light_2') return { kind: 'skipped' }
      return next()
    }
    const h = harness([mw])
    h.driver.failFor.add('light_3')

    const result = await h.run(ALL)

    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions![0]!.targets).toEqual(['light_1'])
  })

  it('opens no suggestion when every target is excluded', async () => {
    const { def } = suggester()
    const mw: Middleware = async (ctx, next) => {
      def.suggest(ctx, choiceQ)
      if (ctx.action.device.id !== 'light_3') return { kind: 'skipped' }
      return next()
    }
    const h = harness([mw])
    h.driver.failFor.add('light_3')

    const result = await h.run(ALL)

    expect(result.suggestions).toBeUndefined()
    expect(h.session.suggestions ?? []).toEqual([])
  })

  it('does not duplicate targets across a pause and replay', async () => {
    const ask = createAsk()
    const { def } = suggester()
    const askMw: Middleware = async (ctx, next) => {
      ask(ctx, { ...choiceQ, key: 'confirm' })
      return next()
    }
    const suggestMw: Middleware = async (ctx, next) => {
      def.suggest(ctx, choiceQ)
      return next()
    }
    const h = harness([askMw, suggestMw])

    const first = await h.run(ONE)
    expect(first.status).toBe('awaiting_interaction')
    expect(first.suggestions).toBeUndefined()

    const second = await h.resume({
      interactionId: first.interaction!.id,
      type: 'choice',
      value: 'day',
    })

    expect(second.status).toBe('success')
    expect(second.suggestions).toHaveLength(1)
    expect(second.suggestions![0]!.targets).toEqual(['light_1'])
  })

  it('opens nothing when the run ends in error', async () => {
    const { def } = suggester()
    const mw: Middleware = async (ctx, next) => {
      def.suggest(ctx, choiceQ)
      if (ctx.action.device.id === 'tv_salon') {
        return { kind: 'blocked', middlewareName: 'guard', reason: 'no' }
      }
      return next()
    }
    const h = harness([mw])

    const result = await h.run(`${ONE}\ntv[salon].power = on`)

    expect(result.status).toBe('error')
    expect(result.suggestions).toBeUndefined()
    expect(h.session.suggestions ?? []).toEqual([])
    expect(h.session._suggestionCandidates ?? []).toEqual([])
  })

  it('opens nothing for a read-only statement', async () => {
    const { mw } = suggester()
    const h = harness([mw])

    const result = await h.run('tv[salon].power?')

    expect(result.status).toBe('success')
    expect(result.suggestions).toBeUndefined()
    expect(h.session.suggestions ?? []).toEqual([])
  })

  it('clears open suggestions when a new command starts', async () => {
    const { mw } = suggester({
      when: ctx => ctx.action.device.type === 'light',
    })
    const h = harness([mw])

    const a = await h.run(ONE)
    expect(a.suggestions).toHaveLength(1)

    const b = await h.run('tv[salon].power = on')
    expect(b.status).toBe('success')
    expect(b.suggestions).toBeUndefined()
    expect(h.session.suggestions ?? []).toEqual([])

    await h.run(ONE_OFF)
    expect(h.session.suggestions).toHaveLength(1)
    const cancelled = await h.cancel()
    expect(cancelled.session.suggestions ?? []).toEqual([])
  })

  it('keeps open suggestions when a new command is rejected as interaction_pending', async () => {
    const { def } = suggester()
    const h = harness([])
    const opened = await (async () => {
      const mw: Middleware = async (ctx, next) => {
        def.suggest(ctx, choiceQ)
        return next()
      }
      const result = await executeCommand(
        { kind: 'run_program', program: parse(ONE) },
        { devices: h.devices, session: h.session, middleware: [mw] },
      )
      return result.suggestions!
    })()
    h.session.pendingInteraction = {
      id: 'x',
      type: 'confirmation',
      context: null,
    }

    const rejected = await h.run('tv[salon].power = on')

    expect(rejected.errors[0]!.code).toBe('interaction_pending')
    expect(h.session.suggestions).toEqual(opened)
  })

  it('throws on invalid questions and non-cloneable data', () => {
    const { def } = suggester()
    const ctx = fakeCtx()

    expect(() => def.suggest(ctx, { ...choiceQ, key: ' ' })).toThrow(Error)
    expect(() => def.suggest(ctx, { ...choiceQ, options: [] })).toThrow(Error)
    expect(() =>
      def.suggest(ctx, { ...choiceQ, data: (() => 1) as never }),
    ).toThrow()
    expect(ctx.session._suggestionCandidates ?? []).toEqual([])
  })

  it('throws when a name is redefined with another apply, and on an empty name', () => {
    const name = uniqueName()
    const apply = () => []
    defineSuggestion(name, { apply })

    expect(() => defineSuggestion(name, { apply: () => [] })).toThrow(Error)
    expect(() => defineSuggestion('', { apply })).toThrow(Error)
  })

  it('returns the same definition for the same apply', () => {
    const name = uniqueName()
    const apply = () => []

    expect(defineSuggestion(name, { apply })).toBe(
      defineSuggestion(name, { apply }),
    )
  })
})
