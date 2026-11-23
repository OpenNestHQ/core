import { describe, it, expect } from 'vitest'
import { MockDriver } from '@opennest/devices'
import { OpenNestClient, createAsk } from '@opennest/sdk'
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

const salonTv: Device = {
  id: 'tv_salon',
  type: 'tv',
  room: 'salon',
  name: 'Salon TV',
  driver,
  driverConfig: {},
}

const chambreTv: Device = {
  id: 'tv_chambre',
  type: 'tv',
  room: 'chambre',
  name: 'Chambre TV',
  driver,
  driverConfig: {},
}

const salonLight: Device = {
  id: 'light_salon',
  type: 'light',
  room: 'salon',
  name: 'Salon Light',
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
    it: salonTv,
    history: [
      entry(
        [salonTv],
        [
          {
            deviceId: 'tv_salon',
            property: 'volume',
            oldValue: 10,
            newValue: 15,
          },
        ],
      ),
      entry([chambreTv], []),
      entry(
        [salonLight],
        [
          {
            deviceId: 'light_salon',
            property: 'power',
            oldValue: false,
            newValue: true,
          },
        ],
      ),
      entry(
        [salonTv],
        [
          {
            deviceId: 'tv_salon',
            property: 'power',
            oldValue: false,
            newValue: true,
          },
        ],
      ),
      entry([], []),
      entry([salonTv, chambreTv], []),
      entry(
        [salonTv],
        [
          {
            deviceId: 'tv_salon',
            property: 'volume',
            oldValue: 15,
            newValue: 20,
          },
        ],
      ),
    ],
    cursor: 7,
    resolvedIds: { ambience: 'light_salon' },
    variableResolvedIds: { tv: 'tv_salon' },
    variableModifiers: {},
    pendingInteraction: null,
    ...overrides,
  }
}

describe('toSessionSummary', () => {
  it('maps variables to resolved device ids, unresolved otherwise', () => {
    const summary = toSessionSummary(makeSession())

    expect(summary.variables).toStrictEqual({
      tv: 'tv_salon',
      ambience: 'light_salon',
      fan: 'unresolved',
    })
  })

  it('summarizes $it without driver state', () => {
    const summary = toSessionSummary(makeSession())

    expect(summary.it).toStrictEqual({
      id: 'tv_salon',
      type: 'tv',
      room: 'salon',
      name: 'Salon TV',
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
          id: 'light_salon',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          owners: ['alice'],
          tags: ['cozy'],
        },
      ],
      changes: [
        {
          deviceId: 'light_salon',
          property: 'power',
          oldValue: false,
          newValue: true,
        },
      ],
    })
    expect(summary.historyTail[4]).toStrictEqual({
      devices: [
        { id: 'tv_salon', type: 'tv', room: 'salon', name: 'Salon TV' },
      ],
      changes: [
        {
          deviceId: 'tv_salon',
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
        devices: [salonTv, chambreTv],
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
        { id: 'tv_salon', label: 'Salon TV' },
        { id: 'tv_chambre', label: 'Chambre TV' },
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
        fingerprint: 'tv_salon::set_property::power',
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
        deviceName: 'Salon TV',
        missing: [
          { name: 'volume', type: 'number' },
          { name: 'mode', type: 'enum', values: ['film', 'nuit'] },
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
        { name: 'mode', type: 'enum', values: ['film', 'nuit'] },
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
        devices: [salonTv],
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
    askDriver.seed('tv_salon', { volume: 15 })
    const ask = createAsk()
    const middleware: Middleware = async (ctx, next) => {
      ask(ctx, question)
      return next()
    }
    const client = new OpenNestClient({
      devices: [{ ...salonTv, driver: askDriver }],
      middleware: [middleware],
    })
    await client.runDsl('tv[salon].volume = 1')
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
      placeholder: 'Salon',
    })
    const summary = toSessionSummary(
      makeSession({ pendingInteraction: pending }),
    )
    expect(summary.pendingInteraction).toStrictEqual({
      type: 'text_input',
      prompt: 'Name?',
      placeholder: 'Salon',
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
