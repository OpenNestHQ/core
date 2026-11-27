import { describe, it, expect } from 'vitest'
import { MockDriver } from '@opennest/devices'
import { OpenNestClient, createAsk, defineSuggestion } from '@opennest/sdk'
import type {
  Device,
  ExecutedStatement,
  Middleware,
  Session,
} from '@opennest/sdk'
import { toSessionSummary } from './session.js'

type Statement = ExecutedStatement['statement']
type PendingInteraction = NonNullable<Session['pendingInteraction']>

const driver = new MockDriver()

const livingRoomTv: Device = {
  id: 'tv_living_room',
  type: 'tv',
  room: 'living_room',
  name: 'Living Room TV',
  driver,
  driverConfig: {},
}

const bedroomTv: Device = {
  id: 'tv_bedroom',
  type: 'tv',
  room: 'bedroom',
  name: 'Bedroom TV',
  driver,
  driverConfig: {},
}

const livingRoomLight: Device = {
  id: 'light_living_room',
  type: 'light',
  room: 'living_room',
  name: 'Living Room Light',
  driver,
  driverConfig: {},
  owners: ['alice'],
  tags: ['cozy'],
}

const queryStatement: Statement = {
  kind: 'query',
  path: [{ identifier: 'tv', selectors: [] }],
}

function entry(
  resolvedDevices: Device[],
  changes: ExecutedStatement['changes'],
): ExecutedStatement {
  return { statement: queryStatement, resolvedDevices, changes }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    programId: 'prog-1',
    variables: {
      tv: { kind: 'device_ref', deviceType: 'tv', selectors: [] },
      ambience: { kind: 'device_ref', deviceType: 'light', selectors: [] },
      fan: { kind: 'device_ref', deviceType: 'fan', selectors: [] },
    },
    argVariables: {},
    it: livingRoomTv,
    history: [
      entry(
        [livingRoomTv],
        [
          {
            deviceId: 'tv_living_room',
            property: 'volume',
            oldValue: 10,
            newValue: 15,
          },
        ],
      ),
      entry([bedroomTv], []),
      entry(
        [livingRoomLight],
        [
          {
            deviceId: 'light_living_room',
            property: 'power',
            oldValue: false,
            newValue: true,
          },
        ],
      ),
      entry(
        [livingRoomTv],
        [
          {
            deviceId: 'tv_living_room',
            property: 'power',
            oldValue: false,
            newValue: true,
          },
        ],
      ),
      entry([], []),
      entry([livingRoomTv, bedroomTv], []),
      entry(
        [livingRoomTv],
        [
          {
            deviceId: 'tv_living_room',
            property: 'volume',
            oldValue: 15,
            newValue: 20,
          },
        ],
      ),
    ],
    cursor: 7,
    resolvedIds: { ambience: 'light_living_room' },
    variableResolvedIds: { tv: 'tv_living_room' },
    variableModifiers: {},
    pendingInteraction: null,
    ...overrides,
  }
}

describe('toSessionSummary', () => {
  it('maps variables to resolved device ids, unresolved otherwise', () => {
    const summary = toSessionSummary(makeSession())

    expect(summary.variables).toStrictEqual({
      tv: 'tv_living_room',
      ambience: 'light_living_room',
      fan: 'unresolved',
    })
  })

  it('summarizes $it without driver state', () => {
    const summary = toSessionSummary(makeSession())

    expect(summary.it).toStrictEqual({
      id: 'tv_living_room',
      type: 'tv',
      room: 'living_room',
      name: 'Living Room TV',
    })
  })

  it('maps a null $it to null', () => {
    const summary = toSessionSummary(makeSession({ it: null }))

    expect(summary.it).toBeNull()
  })

  it('condenses history to the last 5 entries', () => {
    const summary = toSessionSummary(makeSession())

    expect(summary.historyCount).toBe(7)
    expect(summary.historyTail).toHaveLength(5)
    expect(summary.historyTail[0]).toStrictEqual({
      devices: [
        {
          id: 'light_living_room',
          type: 'light',
          room: 'living_room',
          name: 'Living Room Light',
          owners: ['alice'],
          tags: ['cozy'],
        },
      ],
      changes: [
        {
          deviceId: 'light_living_room',
          property: 'power',
          oldValue: false,
          newValue: true,
        },
      ],
    })
    expect(summary.historyTail[4]).toStrictEqual({
      devices: [
        {
          id: 'tv_living_room',
          type: 'tv',
          room: 'living_room',
          name: 'Living Room TV',
        },
      ],
      changes: [
        {
          deviceId: 'tv_living_room',
          property: 'volume',
          oldValue: 15,
          newValue: 20,
        },
      ],
    })
  })

  it('handles an empty history', () => {
    const summary = toSessionSummary(makeSession({ history: [], cursor: 0 }))

    expect(summary.historyCount).toBe(0)
    expect(summary.historyTail).toStrictEqual([])
  })

  it('maps pendingInteraction to null when the session has none', () => {
    const summary = toSessionSummary(makeSession())

    expect(summary.pendingInteraction).toBeNull()
  })

  it('projects a pending device_selection with its choices', () => {
    const pending: PendingInteraction = {
      id: 'interaction_1',
      type: 'device_selection',
      context: {
        devices: [livingRoomTv, bedroomTv],
        deviceType: 'tv',
        variableName: undefined,
      },
    }

    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )

    expect(summary.pendingInteraction).toStrictEqual({
      type: 'device_selection',
      prompt: 'A device selection is pending. Answer it with the respond tool.',
      choices: [
        { id: 'tv_living_room', label: 'Living Room TV' },
        { id: 'tv_bedroom', label: 'Bedroom TV' },
      ],
    })
  })

  it('degrades a pending device_selection with unreadable context to no choices', () => {
    const pending: PendingInteraction = {
      id: 'interaction_1',
      type: 'device_selection',
      context: {},
    }

    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )

    expect(summary.pendingInteraction).toStrictEqual({
      type: 'device_selection',
      prompt: 'A device selection is pending. Answer it with the respond tool.',
      choices: [],
    })
  })

  it('projects a pending confirmation without leaking its resume context', () => {
    const pending: PendingInteraction = {
      id: 'confirm_1',
      type: 'confirmation',
      context: {
        fingerprint: 'tv_living_room::set_property::power',
        decisions: new Map<string, boolean>(),
      },
    }

    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )

    expect(summary.pendingInteraction).toStrictEqual({
      type: 'confirmation',
      prompt: 'A confirmation is pending. Answer it with the respond tool.',
    })
  })

  it('projects a pending action_parameter with its missing parameters', () => {
    const pending: PendingInteraction = {
      id: 'param_1',
      type: 'action_parameter',
      context: {
        stmt: {
          kind: 'action',
          path: [
            { identifier: 'tv', selectors: [] },
            { identifier: 'set_volume', selectors: [] },
          ],
        },
        method: 'set_volume',
        deviceName: 'Living Room TV',
        missing: [
          { name: 'volume', type: 'number' },
          { name: 'mode', type: 'enum', values: ['film', 'night'] },
        ],
      },
    }

    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )

    expect(summary.pendingInteraction).toStrictEqual({
      type: 'action_parameter',
      prompt:
        'Missing action parameters are pending. Answer with the respond tool.',
      missing: [
        { name: 'volume', type: 'number' },
        { name: 'mode', type: 'enum', values: ['film', 'night'] },
      ],
    })
  })

  it('leaves pendingInteraction null for an unprojectable custom type', () => {
    const pending: PendingInteraction = {
      id: 'custom_1',
      type: 'signature',
      context: {},
    }

    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )

    expect(summary.pendingInteraction).toBeNull()
  })

  it('never exposes an interaction id on the projected pending interaction', () => {
    const pending: PendingInteraction = {
      id: 'interaction_1',
      type: 'device_selection',
      context: {
        devices: [livingRoomTv],
        deviceType: 'tv',
        variableName: undefined,
      },
    }

    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )

    expect(summary.pendingInteraction).not.toBeNull()
    expect(summary.pendingInteraction).not.toHaveProperty('id')
  })
})

describe('toSessionSummary with ask questions', () => {
  type AskQuestionInput = Parameters<ReturnType<typeof createAsk>>[1]

  // `AskContext` embeds an internal store, so get a real pending one from a run.
  async function pendingAsk(
    question: AskQuestionInput,
  ): Promise<PendingInteraction> {
    const askDriver = new MockDriver()
    await askDriver.init({})
    askDriver.seed('tv_living_room', { volume: 15 })
    const ask = createAsk()
    const middleware: Middleware = async (ctx, next) => {
      ask(ctx, question)
      return next()
    }
    const client = new OpenNestClient({
      devices: [{ ...livingRoomTv, driver: askDriver }],
      middleware: [middleware],
    })
    await client.runDsl('tv[living_room].volume = 1')
    const pending = client.getSession().pendingInteraction
    if (pending === null) throw new Error('expected a pending interaction')
    return pending
  }

  it('projects a pending ask choice with its options', async () => {
    const pending = await pendingAsk({
      key: 'source',
      type: 'choice',
      message: 'Which source?',
      options: [
        { value: 'hdmi1', label: 'HDMI 1' },
        { value: 'hdmi2', label: 'HDMI 2' },
      ],
    })
    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )
    expect(summary.pendingInteraction).toStrictEqual({
      type: 'choice',
      prompt: 'Which source?',
      choices: [
        { id: 'hdmi1', label: 'HDMI 1' },
        { id: 'hdmi2', label: 'HDMI 2' },
      ],
    })
  })

  it('projects a pending ask number_input with min and max', async () => {
    const pending = await pendingAsk({
      key: 'volume',
      type: 'number_input',
      message: 'Volume?',
      min: 0,
      max: 100,
    })
    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )
    expect(summary.pendingInteraction).toStrictEqual({
      type: 'number_input',
      prompt: 'Volume?',
      min: 0,
      max: 100,
    })
  })

  it('projects a pending ask text_input with its placeholder', async () => {
    const pending = await pendingAsk({
      key: 'name',
      type: 'text_input',
      message: 'Name?',
      placeholder: 'Living Room',
    })
    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )
    expect(summary.pendingInteraction).toStrictEqual({
      type: 'text_input',
      prompt: 'Name?',
      placeholder: 'Living Room',
    })
    expect(JSON.stringify(summary.pendingInteraction)).not.toContain('store')
  })

  it('keeps the generic choice projection without an AskContext', () => {
    const pending: PendingInteraction = {
      id: 'choice_1',
      type: 'choice',
      context: {},
    }
    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )
    expect(summary.pendingInteraction).toStrictEqual({
      type: 'choice',
      prompt: 'A choice is pending. Answer it with the respond tool.',
      choices: [],
    })
  })
})

describe('toSessionSummary with suggestions', () => {
  it('get_session lists open suggestions without data', async () => {
    const suggestionDriver = new MockDriver()
    await suggestionDriver.init({})
    suggestionDriver.seed('tv_living_room', { power: false, volume: 15 })
    const def = defineSuggestion('session_suggestion_1', {
      apply: () => [],
    })
    const client = new OpenNestClient({
      devices: [{ ...livingRoomTv, driver: suggestionDriver }],
      middleware: [
        async (ctx, next) => {
          if (ctx.action.kind === 'set_property') {
            def.suggest(ctx, {
              key: 'level',
              type: 'number_input',
              message: 'Volume?',
              min: 0,
              data: { secret: 'internal' },
            })
          }
          return next()
        },
      ],
    })
    await client.runDsl('tv[living_room].power = on')
    const summary = toSessionSummary(
      client.getSession(),
      client.getSuggestions(),
    )
    expect(summary.suggestions).toEqual([
      {
        id: client.getSuggestions()[0]!.id,
        type: 'number_input',
        prompt: 'Volume?',
        min: 0,
        devices: ['Living Room TV'],
      },
    ])
    expect(JSON.stringify(summary)).not.toContain('secret')
  })

  it('omits suggestions when none are open', () => {
    expect(toSessionSummary(makeSession())).not.toHaveProperty('suggestions')
  })
})
