import { describe, it, expect } from 'vitest'
import type {
  ExecutedStatementSummary,
  RunResult,
  UserInteraction,
} from '@opennest/sdk'
import { toInteractionPrompt, toToolResult } from './result.js'

type Statement = ExecutedStatementSummary['statement']

function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: 'success',
    executed: [],
    interaction: null,
    errors: [],
    ...overrides,
  }
}

const statement: Statement = {
  kind: 'query',
  path: [{ identifier: 'tv', selectors: [] }],
}

const executed: ExecutedStatementSummary[] = [
  {
    statement,
    resolvedDevices: [
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
        property: 'power',
        oldValue: false,
        newValue: true,
      },
    ],
  },
]

const deviceSelectionInteraction: UserInteraction = {
  id: 'interaction_1_mufku5cp',
  type: 'device_selection',
  message: 'Multiple "tv" devices found. Please select one:',
  devices: [
    {
      id: 'tv_living_room',
      name: 'Living Room TV',
      type: 'tv',
      room: 'living_room',
    },
    { id: 'tv_bedroom', name: 'Bedroom TV', type: 'tv', room: 'bedroom' },
  ],
}

const confirmationInteraction: UserInteraction = {
  id: 'confirm_1',
  type: 'confirmation',
  message: 'Set power on Living Room TV (tv in living_room) to on?',
}

const textInputInteraction: UserInteraction = {
  id: 'text_1',
  type: 'text_input',
  message: 'Which room do you mean?',
  placeholder: 'living_room',
}

const numberInputInteraction: UserInteraction = {
  id: 'number_1',
  type: 'number_input',
  message: 'What volume level?',
  min: 0,
  max: 100,
}

const choiceInteraction: UserInteraction = {
  id: 'choice_1',
  type: 'choice',
  message: 'Which mode?',
  options: [
    { value: 'film', label: 'Film' },
    { value: 'night', label: 'Night' },
  ],
}

const actionParameterInteraction: UserInteraction = {
  id: 'param_1',
  type: 'action_parameter',
  message:
    'Missing parameters for set_volume() on Living Room TV: volume: number, mode: film|night',
  deviceName: 'Living Room TV',
  action: 'set_volume',
  missing: [
    { name: 'volume', type: 'number' },
    { name: 'mode', type: 'enum', values: ['film', 'night'] },
  ],
}

const allInteractions: UserInteraction[] = [
  deviceSelectionInteraction,
  confirmationInteraction,
  textInputInteraction,
  numberInputInteraction,
  choiceInteraction,
  actionParameterInteraction,
]

describe('toInteractionPrompt', () => {
  it('maps device_selection devices to choices with preserved ids', () => {
    const prompt = toInteractionPrompt(deviceSelectionInteraction)

    expect(prompt).toEqual({
      type: 'device_selection',
      prompt: 'Multiple "tv" devices found. Please select one:',
      choices: [
        { id: 'tv_living_room', label: 'Living Room TV' },
        { id: 'tv_bedroom', label: 'Bedroom TV' },
      ],
    })
  })

  it('maps an empty device list to an empty choices list', () => {
    const prompt = toInteractionPrompt({
      id: 'interaction_empty',
      type: 'device_selection',
      message: 'No devices to select',
      devices: [],
    })

    expect(prompt).toEqual({
      type: 'device_selection',
      prompt: 'No devices to select',
      choices: [],
    })
  })

  it('maps a confirmation interaction to a bare prompt', () => {
    const prompt = toInteractionPrompt(confirmationInteraction)

    expect(prompt).toEqual({
      type: 'confirmation',
      prompt: 'Set power on Living Room TV (tv in living_room) to on?',
    })
  })

  it('maps text_input with a placeholder, and omits it when absent', () => {
    expect(toInteractionPrompt(textInputInteraction)).toStrictEqual({
      type: 'text_input',
      prompt: 'Which room do you mean?',
      placeholder: 'living_room',
    })

    expect(
      toInteractionPrompt({
        id: 'text_2',
        type: 'text_input',
        message: 'Name?',
      }),
    ).toStrictEqual({ type: 'text_input', prompt: 'Name?' })
  })

  it('maps number_input bounds, and omits them when absent', () => {
    expect(toInteractionPrompt(numberInputInteraction)).toStrictEqual({
      type: 'number_input',
      prompt: 'What volume level?',
      min: 0,
      max: 100,
    })

    expect(
      toInteractionPrompt({
        id: 'number_2',
        type: 'number_input',
        message: 'Volume?',
      }),
    ).toStrictEqual({ type: 'number_input', prompt: 'Volume?' })
  })

  it('maps choice options to choices keyed by value', () => {
    const prompt = toInteractionPrompt(choiceInteraction)

    expect(prompt).toEqual({
      type: 'choice',
      prompt: 'Which mode?',
      choices: [
        { id: 'film', label: 'Film' },
        { id: 'night', label: 'Night' },
      ],
    })
  })

  it('maps action_parameter missing parameters instead of failing', () => {
    const prompt = toInteractionPrompt(actionParameterInteraction)

    expect(prompt).toStrictEqual({
      type: 'action_parameter',
      prompt:
        'Missing parameters for set_volume() on Living Room TV: volume: number, mode: film|night',
      missing: [
        { name: 'volume', type: 'number' },
        { name: 'mode', type: 'enum', values: ['film', 'night'] },
      ],
    })
  })

  it('never exposes an interaction id on any projected variant', () => {
    for (const interaction of allInteractions) {
      const prompt = toInteractionPrompt(interaction)

      expect(prompt).not.toBeNull()
      expect(prompt).not.toHaveProperty('id')
    }
  })
})

describe('toToolResult', () => {
  it('slices executed from the given baseline', () => {
    const result = toToolResult(
      runResult({ executed: [...executed, ...executed] }),
      {
        executedFrom: executed.length,
      },
    )
    expect(result).toMatchObject({ status: 'completed' })
    if (result.status !== 'completed') return
    expect(result.result?.executed).toHaveLength(executed.length)
  })

  it('reports failed outcomes as deviceFailures with a default message', () => {
    const failing = [
      {
        ...executed[0]!,
        outcomes: [
          {
            deviceId: 'tv_living_room',
            execution: { status: 'failed' as const, error: 'boom' },
            verification: { status: 'not_observable' as const },
          },
          {
            deviceId: 'lamp',
            execution: { status: 'failed' as const },
            verification: { status: 'not_observable' as const },
          },
          {
            deviceId: 'ok',
            execution: { status: 'accepted' as const },
            verification: { status: 'not_observable' as const },
          },
        ],
      },
    ]
    const result = toToolResult(runResult({ executed: failing }))
    expect(result).toMatchObject({
      status: 'completed',
      deviceFailures: [
        { deviceId: 'tv_living_room', message: 'boom' },
        { deviceId: 'lamp', message: 'Device command failed' },
      ],
    })
  })

  it('maps a successful run to a flat completed envelope', () => {
    const result = toToolResult(runResult({ executed }))

    expect(result).not.toHaveProperty('execution')
    expect(result).toStrictEqual({
      status: 'completed',
      result: { status: 'success', executed, errors: [] },
    })
  })

  it('maps every interaction type to waiting_for_user', () => {
    for (const interaction of allInteractions) {
      const result = toToolResult(
        runResult({ status: 'awaiting_interaction', interaction }),
      )

      expect(result.status).toBe('waiting_for_user')
    }
  })

  it('carries the projected prompt on waiting_for_user', () => {
    const result = toToolResult(
      runResult({
        status: 'awaiting_interaction',
        interaction: deviceSelectionInteraction,
      }),
    )

    if (result.status !== 'waiting_for_user') {
      throw new Error('expected waiting_for_user')
    }

    expect(result.interaction).toEqual({
      type: 'device_selection',
      prompt: 'Multiple "tv" devices found. Please select one:',
      choices: [
        { id: 'tv_living_room', label: 'Living Room TV' },
        { id: 'tv_bedroom', label: 'Bedroom TV' },
      ],
    })
  })

  it('maps an error status to failed with execution_failed', () => {
    const result = toToolResult(
      runResult({
        status: 'error',
        errors: [
          {
            code: 'device_not_found',
            message: "No device of type 'camera' found",
          },
          { message: 'Another failure' },
        ],
      }),
    )

    expect(result).toStrictEqual({
      status: 'failed',
      error: {
        code: 'execution_failed',
        message: "No device of type 'camera' found; Another failure",
      },
    })
  })

  it('maps non-empty errors on a non-error status to failed', () => {
    const result = toToolResult(runResult({ errors: [{ message: 'boom' }] }))

    expect(result).toStrictEqual({
      status: 'failed',
      error: { code: 'execution_failed', message: 'boom' },
    })
  })

  it('falls back to a generic message when an error run has no errors', () => {
    const result = toToolResult(runResult({ status: 'error' }))

    expect(result).toStrictEqual({
      status: 'failed',
      error: { code: 'execution_failed', message: 'Execution failed' },
    })
  })

  it('maps an unknown interaction type to unsupported_interaction_type', () => {
    const unknown = {
      ...confirmationInteraction,
      type: 'signature',
    } as unknown as UserInteraction

    const result = toToolResult(
      runResult({ status: 'awaiting_interaction', interaction: unknown }),
    )

    expect(result).toStrictEqual({
      status: 'failed',
      error: {
        code: 'unsupported_interaction_type',
        message: 'Unsupported interaction type: signature',
      },
    })
  })
})
