import { describe, it, expect } from 'vitest'
import { parseHomeDSL } from '@opennest/lang-core'
import { MockDriver } from '@opennest/devices'
import {
  executeCommand,
  createSession,
  createAsk,
  checkInputAnswer,
  createConfirmationMiddleware,
  PauseSignal,
} from '../index.js'
import type {
  Device,
  Middleware,
  MiddlewareContext,
  UserResponse,
  VMResult,
} from '../index.js'
import { AskStore } from './ask.js'

class CountingDriver extends MockDriver {
  sets: { deviceId: string; property: string; value: unknown }[] = []

  override setProperty(
    deviceId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    this.sets.push({ deviceId, property, value })
    return super.setProperty(deviceId, property, value)
  }
}

function makeDevice(
  driver: CountingDriver,
  id: string,
  type: string,
  room: string,
  name: string,
  initialState: Record<string, unknown> = {},
): Device {
  driver.seed(id, initialState)
  return { id, type, room, name, driver, driverConfig: {} }
}

function inventory() {
  const driver = new CountingDriver()
  const devices = [
    makeDevice(driver, 'light_1', 'light', 'living_room', 'Light 1', {
      power: false,
    }),
    makeDevice(driver, 'light_2', 'light', 'living_room', 'Light 2', {
      power: false,
    }),
    makeDevice(driver, 'light_3', 'light', 'living_room', 'Light 3', {
      power: false,
    }),
    makeDevice(
      driver,
      'tv_living_room',
      'tv',
      'living_room',
      'Living Room TV',
      {
        power: false,
        input: 'hdmi1',
      },
    ),
    makeDevice(
      driver,
      'thermostat_living_room',
      'thermostat',
      'living_room',
      'Living Room Thermostat',
      { temperature: 20 },
    ),
  ]
  return { driver, devices }
}

function parse(code: string) {
  const result = parseHomeDSL(code)
  if (result.errors.length > 0) {
    throw new Error(
      `Parse errors: ${result.errors.map(e => e.message).join(', ')}`,
    )
  }
  return result.program
}

/** A tiny harness: one session, one inventory, one middleware chain. */
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
  }
}

function pendingId(result: VMResult): string {
  expect(result.status).toBe('awaiting_interaction')
  return result.interaction!.id
}

const roomChoice = {
  key: 'mode',
  type: 'choice' as const,
  message: 'Which mode?',
  options: [
    { value: 'cinema', label: 'Cinema' },
    { value: 'day', label: 'Day' },
  ],
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

describe('ask()', () => {
  it('pauses with a choice interaction and resumes with the chosen value', async () => {
    const ask = createAsk()
    const seen: string[] = []
    const mw: Middleware = async (ctx, next) => {
      const mode = ask(ctx, roomChoice)
      seen.push(mode)
      if (ctx.action.kind === 'set_property') {
        ctx.action.value = { kind: 'string', value: mode }
      }
      return next()
    }
    const h = harness([mw])

    const first = await h.run('tv[living_room].input = "x"')
    expect(first.status).toBe('awaiting_interaction')
    const interaction = first.interaction!
    expect(interaction.type).toBe('choice')
    if (interaction.type !== 'choice') throw new Error('unreachable')
    expect(interaction.message).toBe('Which mode?')
    expect(interaction.options).toEqual(roomChoice.options)
    expect(h.driver.sets).toHaveLength(0)

    const second = await h.resume({
      interactionId: interaction.id,
      type: 'choice',
      value: 'cinema',
    })
    expect(second.status).toBe('success')
    expect(seen).toEqual(['cinema'])
    expect(h.driver.sets).toEqual([
      { deviceId: 'tv_living_room', property: 'input', value: 'cinema' },
    ])
  })

  it('returns a number for number_input and a trimmed string for text_input', async () => {
    const ask = createAsk()
    const answers: unknown[] = []
    const mw: Middleware = async (ctx, next) => {
      const n = ask(ctx, { key: 'n', type: 'number_input', message: 'N?' })
      const t = ask(ctx, {
        key: 't',
        type: 'text_input',
        message: 'T?',
        placeholder: 'room',
      })
      answers.push(n, t)
      return next()
    }
    const h = harness([mw])

    const first = await h.run('tv[living_room].power = on')
    expect(first.interaction!.type).toBe('number_input')
    const second = await h.resume({
      interactionId: pendingId(first),
      type: 'number_input',
      value: 3,
    })
    expect(second.interaction).toMatchObject({
      type: 'text_input',
      message: 'T?',
      placeholder: 'room',
    })
    const third = await h.resume({
      interactionId: pendingId(second),
      type: 'text_input',
      text: '  living_room  ',
    })
    expect(third.status).toBe('success')
    expect(typeof answers[0]).toBe('number')
    expect(answers).toEqual([3, 'living_room'])
  })

  it('rejects out-of-range numbers with invalid_response and keeps the question pending', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, {
        key: 'temp',
        type: 'number_input',
        message: 'Temperature?',
        min: 15,
        max: 28,
      })
      return next()
    }
    const h = harness([mw])

    const first = await h.run('tv[living_room].power = on')
    const id = pendingId(first)
    const pending = h.session.pendingInteraction

    const bad = await h.resume({
      interactionId: id,
      type: 'number_input',
      value: 30,
    })
    expect(bad.status).toBe('error')
    expect(bad.errors[0]!.code).toBe('invalid_response')
    expect(bad.errors[0]!.message).toContain('15')
    expect(bad.errors[0]!.message).toContain('28')
    expect(h.session.pendingInteraction).toBe(pending)
    expect(h.driver.sets).toHaveLength(0)

    const ok = await h.resume({
      interactionId: id,
      type: 'number_input',
      value: 28,
    })
    expect(ok.status).toBe('success')
    expect(h.driver.sets).toHaveLength(1)
  })

  it('rejects an unknown choice and an empty text with invalid_response', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, roomChoice)
      ask(ctx, { key: 'name', type: 'text_input', message: 'Name?' })
      return next()
    }
    const h = harness([mw])

    const first = await h.run('tv[living_room].power = on')
    const choiceId = pendingId(first)
    const badChoice = await h.resume({
      interactionId: choiceId,
      type: 'choice',
      value: 'night',
    })
    expect(badChoice.errors[0]!.code).toBe('invalid_response')
    expect(badChoice.errors[0]!.message).toContain('cinema')
    expect(h.session.pendingInteraction?.id).toBe(choiceId)

    const text = await h.resume({
      interactionId: choiceId,
      type: 'choice',
      value: 'day',
    })
    const textId = pendingId(text)
    const badText = await h.resume({
      interactionId: textId,
      type: 'text_input',
      text: '   ',
    })
    expect(badText.errors[0]!.code).toBe('invalid_response')
    expect(h.session.pendingInteraction?.id).toBe(textId)
  })

  it('rejects a response of another type with interaction_type_mismatch', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, roomChoice)
      return next()
    }
    const h = harness([mw])

    const first = await h.run('tv[living_room].power = on')
    const result = await h.resume({
      interactionId: pendingId(first),
      type: 'text_input',
      text: 'cinema',
    })
    expect(result.status).toBe('error')
    expect(result.errors[0]!.code).toBe('interaction_type_mismatch')
    expect(h.session.pendingInteraction).not.toBeNull()
  })

  it('asks once per device and executes the batch once', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, roomChoice)
      return next()
    }
    const h = harness([mw])
    const code = '$l = @all(light[living_room])\n$l.power = on'

    let result = await h.run(code)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      expect(result.status).toBe('awaiting_interaction')
      expect(h.driver.sets).toHaveLength(0)
      ids.push(result.interaction!.id)
      result = await h.resume({
        interactionId: result.interaction!.id,
        type: 'choice',
        value: 'day',
      })
    }
    expect(new Set(ids).size).toBe(3)
    expect(result.status).toBe('success')
    expect(h.driver.sets.map(s => s.deviceId).sort()).toEqual([
      'light_1',
      'light_2',
      'light_3',
    ])
  })

  it('asks once per statement with scope statement', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, { ...roomChoice, scope: 'statement' })
      return next()
    }
    const h = harness([mw])

    const first = await h.run('$l = @all(light[living_room])\n$l.power = on')
    const second = await h.resume({
      interactionId: pendingId(first),
      type: 'choice',
      value: 'day',
    })
    expect(second.status).toBe('success')
    expect(h.driver.sets).toHaveLength(3)
  })

  it('applies an increment exactly once after an answer', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, { ...roomChoice, key: 'gate' })
      return next()
    }
    const h = harness([mw])

    const first = await h.run('thermostat[living_room].temperature += 1')
    const second = await h.resume({
      interactionId: pendingId(first),
      type: 'choice',
      value: 'day',
    })
    expect(second.status).toBe('success')
    expect(h.driver.sets).toHaveLength(1)
    expect(
      await h.driver.getProperty('thermostat_living_room', 'temperature'),
    ).toBe(21)
  })

  it('keeps an answer across a later confirmation pause', async () => {
    const ask = createAsk()
    let asked = 0
    const askMw: Middleware = async (ctx, next) => {
      try {
        ask(ctx, roomChoice)
      } catch (error) {
        if (error instanceof PauseSignal) asked++
        throw error
      }
      return next()
    }
    const confirm = createConfirmationMiddleware({
      requireConfirmation: () => true,
    })
    const h = harness([askMw, confirm])

    const first = await h.run('tv[living_room].power = on')
    expect(first.interaction!.type).toBe('choice')
    const second = await h.resume({
      interactionId: pendingId(first),
      type: 'choice',
      value: 'cinema',
    })
    expect(second.interaction!.type).toBe('confirmation')
    const third = await h.resume({
      interactionId: pendingId(second),
      type: 'confirmation',
      confirmed: true,
    })
    expect(third.status).toBe('success')
    expect(asked).toBe(1)
    expect(h.driver.sets).toHaveLength(1)
  })

  it('does not reuse an answer in a later program run', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, roomChoice)
      return next()
    }
    const h = harness([mw])

    const first = await h.run('tv[living_room].power = on')
    const done = await h.resume({
      interactionId: pendingId(first),
      type: 'choice',
      value: 'cinema',
    })
    expect(done.status).toBe('success')

    const again = await h.run('tv[living_room].power = on')
    expect(again.status).toBe('awaiting_interaction')
    expect(again.interaction!.type).toBe('choice')
  })

  it('throws on invalid questions', async () => {
    const ask = createAsk()
    const ctx = fakeCtx()

    expect(() => ask(ctx, { ...roomChoice, key: '' })).toThrow(/key/)
    expect(() => ask(ctx, { ...roomChoice, options: [] })).toThrow(/option/)
    expect(() =>
      ask(ctx, {
        ...roomChoice,
        options: [
          { value: 'a', label: 'A' },
          { value: 'a', label: 'A again' },
        ],
      }),
    ).toThrow(/option/)
    expect(() =>
      ask(ctx, {
        key: 'n',
        type: 'number_input',
        message: 'N?',
        min: 5,
        max: 1,
      }),
    ).toThrow(/min/)
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() =>
        ask(ctx, { key: 'n', type: 'number_input', message: 'N?', min: bad }),
      ).toThrow(/finite/)
      expect(() =>
        ask(ctx, { key: 'n', type: 'number_input', message: 'N?', max: bad }),
      ).toThrow(/finite/)
    }

    const mw: Middleware = async (c, next) => {
      ask(c, { ...roomChoice, options: [] })
      return next()
    }
    const h = harness([mw])
    await expect(h.run('tv[living_room].power = on')).rejects.toThrow(/option/)
  })

  it('does not return an answer given to a different question type under the same key', async () => {
    const ask = createAsk()
    const mw: Middleware = async (ctx, next) => {
      ask(ctx, { key: 'k', type: 'number_input', message: 'N?' })
      ask(ctx, { key: 'k', type: 'text_input', message: 'T?' })
      return next()
    }
    const h = harness([mw])
    const first = await h.run('tv[living_room].power = on')
    expect(first.interaction!.type).toBe('number_input')
    const second = await h.resume({
      interactionId: pendingId(first),
      type: 'number_input',
      value: 5,
    })
    expect(second.status).toBe('awaiting_interaction')
    expect(second.interaction!.type).toBe('text_input')
  })

  it('refuses hand-rolled input interactions without an AskContext', async () => {
    const mw: Middleware = async () => {
      throw new PauseSignal(
        {
          id: 'hand_rolled',
          type: 'choice',
          message: 'Pick',
          options: [{ value: 'a', label: 'A' }],
        },
        {},
      )
    }
    const h = harness([mw])

    const first = await h.run('tv[living_room].power = on')
    await expect(
      h.resume({
        interactionId: pendingId(first),
        type: 'choice',
        value: 'a',
      }),
    ).rejects.toThrow(/ask\(\)/)
  })
})

describe('AskStore', () => {
  it('evicts the least recently used program partition beyond 64', () => {
    const store = new AskStore()
    for (let i = 0; i < 64; i++) store.set(`run_${i}`, 'k', i)
    // Touch run_0 so run_1 becomes the least recently used partition.
    expect(store.get('run_0', 'k')).toBe(0)
    store.set('run_64', 'k', 64)

    expect(store.get('run_1', 'k')).toBeUndefined()
    expect(store.get('run_0', 'k')).toBe(0)
    expect(store.get('run_2', 'k')).toBe(2)
    expect(store.get('run_64', 'k')).toBe(64)
  })
})

describe('checkInputAnswer', () => {
  const options = [
    { value: 'cinema', label: 'Cinema' },
    { value: 'day', label: 'Day' },
  ]
  const id = 'i'

  it.each([
    [
      'text ok (trimmed)',
      { type: 'text_input' as const },
      { interactionId: id, type: 'text_input' as const, text: ' hi ' },
      { ok: true, value: 'hi' },
    ],
    [
      'text empty',
      { type: 'text_input' as const },
      { interactionId: id, type: 'text_input' as const, text: '  ' },
      { ok: false },
    ],
    [
      'text not a string',
      { type: 'text_input' as const },
      {
        interactionId: id,
        type: 'text_input' as const,
        text: 5 as unknown as string,
      },
      { ok: false },
    ],
    [
      'choice not a string',
      { type: 'choice' as const, options },
      {
        interactionId: id,
        type: 'choice' as const,
        value: 5 as unknown as string,
      },
      { ok: false },
    ],
    [
      'number ok',
      { type: 'number_input' as const, min: 15, max: 28 },
      { interactionId: id, type: 'number_input' as const, value: 20 },
      { ok: true, value: 20 },
    ],
    [
      'number NaN',
      { type: 'number_input' as const },
      { interactionId: id, type: 'number_input' as const, value: NaN },
      { ok: false },
    ],
    [
      'number Infinity',
      { type: 'number_input' as const },
      { interactionId: id, type: 'number_input' as const, value: Infinity },
      { ok: false },
    ],
    [
      'number below min',
      { type: 'number_input' as const, min: 15, max: 28 },
      { interactionId: id, type: 'number_input' as const, value: 14.5 },
      { ok: false },
    ],
    [
      'number above max',
      { type: 'number_input' as const, min: 15, max: 28 },
      { interactionId: id, type: 'number_input' as const, value: 28.1 },
      { ok: false },
    ],
    [
      'number at min',
      { type: 'number_input' as const, min: 15, max: 28 },
      { interactionId: id, type: 'number_input' as const, value: 15 },
      { ok: true, value: 15 },
    ],
    [
      'number at max',
      { type: 'number_input' as const, min: 15, max: 28 },
      { interactionId: id, type: 'number_input' as const, value: 28 },
      { ok: true, value: 28 },
    ],
    [
      'choice ok',
      { type: 'choice' as const, options },
      { interactionId: id, type: 'choice' as const, value: 'day' },
      { ok: true, value: 'day' },
    ],
    [
      'choice unknown',
      { type: 'choice' as const, options },
      { interactionId: id, type: 'choice' as const, value: 'Day' },
      { ok: false },
    ],
  ])('%s', (_name, spec, response, expected) => {
    const result = checkInputAnswer(spec, response)
    expect(result).toMatchObject(expected)
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0)
  })
})
