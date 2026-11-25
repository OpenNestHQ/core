import { describe, it, expect, vi } from 'vitest'
import type {
  DSLFeedback,
  ExecutedStatementSummary,
  ResumeAnswer,
  RunResult,
  Session,
  SuggestionResponse,
  SuggestionSummary,
  UserInteraction,
} from '@opennest/sdk'
import { createGuardedRuntime, DEFAULT_MAX_FAILED_RESUMES } from './runtime.js'
import type { InteractionClient } from './runtime.js'

type Statement = ExecutedStatementSummary['statement']

const RUN_DSL_BLOCKED_MESSAGE =
  'Resolve the pending interaction with `respond`, or call `cancel`. `run_dsl` is disabled until then.'
const CHECK_BLOCKED_MESSAGE =
  'Resolve the pending interaction with `respond`, or call `cancel`. `run_dsl` (including `dryRun`) is disabled until then.'
const NO_PENDING_MESSAGE = 'No interaction is pending. Execute a program first.'
const ABORT_MESSAGE =
  'Too many invalid answers; the pending interaction was cancelled. Ask the user again from the start.'
const FIX_PROGRAM_HINT = 'Fix the HomeDSL program and call `run_dsl` again.'

function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: 'success',
    executed: [],
    interaction: null,
    errors: [],
    ...overrides,
  }
}

function errorResult(code: string, message: string): RunResult {
  return runResult({ status: 'error', errors: [{ code, message }] })
}

function failed(code: string, message: string, hint?: string) {
  return {
    status: 'failed',
    error: { code, message, ...(hint !== undefined ? { hint } : {}) },
  }
}

function okFeedback(): DSLFeedback {
  return { program: null, parseErrors: [], validationErrors: [], ok: true }
}

function parseErrorFeedback(message: string): DSLFeedback {
  return {
    program: null,
    parseErrors: [{ message, line: 2, column: 7 }],
    validationErrors: [],
    ok: false,
  }
}

function validationErrorFeedback(message: string): DSLFeedback {
  return {
    program: null,
    parseErrors: [],
    validationErrors: [{ message }],
    ok: false,
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

const deviceSelection: UserInteraction = {
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
    { id: 'tv_kitchen', name: 'Kitchen TV', type: 'tv', room: 'kitchen' },
  ],
}

const secondDeviceSelection: UserInteraction = {
  id: 'interaction_2_k3p9tq7x',
  type: 'device_selection',
  message: 'Multiple "light" devices found. Please select one:',
  devices: [
    {
      id: 'lamp_living_room',
      name: 'Living Room Lamp',
      type: 'light',
      room: 'living_room',
    },
    {
      id: 'lamp_kitchen',
      name: 'Kitchen Lamp',
      type: 'light',
      room: 'kitchen',
    },
  ],
}

const confirmationInteraction: UserInteraction = {
  id: 'confirm_1',
  type: 'confirmation',
  message: 'Set power on Living Room TV (tv in living_room) to on?',
}

const answer: ResumeAnswer = {
  type: 'device_selection',
  deviceId: 'tv_living_room',
}

const wrongTypeAnswer: ResumeAnswer = {
  type: 'text_input',
  text: 'the living room one',
}

function fakeClient(pending: UserInteraction | null) {
  const runDsl = vi.fn<(dsl: string) => Promise<RunResult>>()
  const analyze = vi
    .fn<(dsl: string) => DSLFeedback>()
    .mockReturnValue(okFeedback())
  const resumePending = vi.fn<(answer: ResumeAnswer) => Promise<RunResult>>()
  const getPendingInteraction = vi.fn((): UserInteraction | null => pending)
  const cancel = vi.fn<() => Promise<RunResult>>()
  const getSuggestions = vi.fn((): SuggestionSummary[] => [])
  const answerSuggestion =
    vi.fn<(id: string, answer: SuggestionResponse) => Promise<RunResult>>()
  const dismissSuggestion = vi.fn<(id: string) => boolean>(() => true)
  const session = { history: [] as unknown[] }
  const getSession = vi.fn(() => session as unknown as Session)
  const client: InteractionClient = {
    getSession,
    runDsl,
    analyze,
    resumePending,
    getPendingInteraction,
    cancel,
    getSuggestions,
    answerSuggestion,
    dismissSuggestion,
  }
  return {
    client,
    runDsl,
    analyze,
    resumePending,
    getPendingInteraction,
    cancel,
    answerSuggestion,
    dismissSuggestion,
    setPending(next: UserInteraction | null) {
      pending = next
    },
    session,
  }
}

describe('createGuardedRuntime', () => {
  describe('answerSuggestion budget', () => {
    const suggestionAnswer: SuggestionResponse = {
      type: 'number_input',
      value: 500,
    }

    it('still aborts when invalid answers alternate with a wrong type', async () => {
      const { client, answerSuggestion, dismissSuggestion } = fakeClient(null)
      const runtime = createGuardedRuntime(client)
      const invalid = errorResult('invalid_response', 'out of range')
      const mismatch = errorResult('interaction_type_mismatch', 'wrong type')
      answerSuggestion
        .mockResolvedValueOnce(invalid)
        .mockResolvedValueOnce(mismatch)
        .mockResolvedValueOnce(invalid)
        .mockResolvedValueOnce(mismatch)
        .mockResolvedValueOnce(invalid)

      const codes: string[] = []
      for (let i = 0; i < 5; i++) {
        const r = await runtime.answerSuggestion('s1', suggestionAnswer)
        codes.push((r as { error: { code: string } }).error.code)
      }

      expect(codes).toEqual([
        'invalid_response',
        'interaction_type_mismatch',
        'invalid_response',
        'interaction_type_mismatch',
        'suggestion_aborted',
      ])
      expect(dismissSuggestion).toHaveBeenCalledWith('s1')
    })

    it('keeps the suggestion counter separate from respond failures', async () => {
      const fake = fakeClient(deviceSelection)
      const runtime = createGuardedRuntime(fake.client)
      const invalid = errorResult('invalid_response', 'bad')
      fake.resumePending.mockResolvedValue(invalid)
      fake.answerSuggestion.mockResolvedValue(invalid)

      fake.setPending(null)
      for (let i = 0; i < 2; i++) {
        expect(
          await runtime.answerSuggestion('s1', suggestionAnswer),
        ).toMatchObject({ error: { code: 'invalid_response' } })
      }
      // respond's own budget was not spent by the suggestion failures.
      fake.setPending(deviceSelection)
      for (let i = 0; i < 2; i++) {
        expect(await runtime.respond(answer)).toMatchObject({
          error: { code: 'invalid_response' },
        })
      }
      // ...and neither did respond's failures spend the suggestion's.
      fake.setPending(null)
      expect(
        await runtime.answerSuggestion('s1', suggestionAnswer),
      ).toMatchObject({ error: { code: 'suggestion_aborted' } })
    })
  })

  describe('runDsl guard', () => {
    it('blocks run_dsl while an interaction is pending without calling the core', async () => {
      const { client, runDsl, analyze } = fakeClient(deviceSelection)
      const runtime = createGuardedRuntime(client)

      const result = await runtime.runDsl('tv.power=on')

      expect(result).toStrictEqual({
        status: 'blocked',
        error: {
          code: 'interaction_pending',
          message: RUN_DSL_BLOCKED_MESSAGE,
          interactionType: 'device_selection',
        },
      })
      expect(result).not.toHaveProperty('error.interactionId')
      expect(runDsl).not.toHaveBeenCalled()
      expect(analyze).not.toHaveBeenCalled()
    })

    it('fires the pending guard before pre-classification', async () => {
      const { client, analyze, runDsl } = fakeClient(deviceSelection)
      analyze.mockReturnValue(parseErrorFeedback('Expected end of input'))
      const runtime = createGuardedRuntime(client)

      const result = await runtime.runDsl('tv.power=')

      expect(result.status).toBe('blocked')
      expect(analyze).not.toHaveBeenCalled()
      expect(runDsl).not.toHaveBeenCalled()
    })
  })

  describe('runDsl pre-classification', () => {
    it('classifies parse errors as parse_error without executing', async () => {
      const { client, analyze, runDsl } = fakeClient(null)
      analyze.mockReturnValue(parseErrorFeedback('Expected end of input'))
      const runtime = createGuardedRuntime(client)

      const result = await runtime.runDsl('tv.power=')

      expect(result).toStrictEqual(
        failed('parse_error', 'Expected end of input', FIX_PROGRAM_HINT),
      )
      expect(analyze).toHaveBeenCalledWith('tv.power=')
      expect(runDsl).not.toHaveBeenCalled()
    })

    it('classifies validation errors as validation_error without executing', async () => {
      const { client, analyze, runDsl } = fakeClient(null)
      analyze.mockReturnValue(
        validationErrorFeedback("Unknown device type 'camera'"),
      )
      const runtime = createGuardedRuntime(client)

      const result = await runtime.runDsl('camera[living_room].power = on')

      expect(result).toStrictEqual(
        failed(
          'validation_error',
          "Unknown device type 'camera'",
          FIX_PROGRAM_HINT,
        ),
      )
      expect(analyze).toHaveBeenCalledWith('camera[living_room].power = on')
      expect(runDsl).not.toHaveBeenCalled()
    })

    it('executes the program when analyze is clean', async () => {
      const { client, runDsl, analyze } = fakeClient(null)
      runDsl.mockResolvedValue(runResult({ executed }))
      const runtime = createGuardedRuntime(client)

      const result = await runtime.runDsl('tv[living_room].power = on')

      expect(analyze).toHaveBeenCalledWith('tv[living_room].power = on')
      expect(runDsl).toHaveBeenCalledWith('tv[living_room].power = on')
      expect(result).toStrictEqual({
        status: 'completed',
        result: { status: 'success', executed, errors: [] },
      })
    })
  })

  describe('check', () => {
    it('returns a bare completed envelope for a valid program', async () => {
      const { client, analyze, runDsl, resumePending, cancel } =
        fakeClient(null)
      const runtime = createGuardedRuntime(client)

      const result = await runtime.check('tv[living_room].power = on')

      expect(result).toStrictEqual({ status: 'completed' })
      expect(analyze).toHaveBeenCalledWith('tv[living_room].power = on')
      expect(runDsl).not.toHaveBeenCalled()
      expect(resumePending).not.toHaveBeenCalled()
      expect(cancel).not.toHaveBeenCalled()
    })

    it('classifies parse errors as parse_error', async () => {
      const { client, analyze } = fakeClient(null)
      analyze.mockReturnValue(parseErrorFeedback('Expected end of input'))
      const runtime = createGuardedRuntime(client)

      const result = await runtime.check('tv.power=')

      expect(result).toStrictEqual(
        failed('parse_error', 'Expected end of input', FIX_PROGRAM_HINT),
      )
    })

    it('classifies validation errors as validation_error', async () => {
      const { client, analyze } = fakeClient(null)
      analyze.mockReturnValue(
        validationErrorFeedback("Unknown device type 'camera'"),
      )
      const runtime = createGuardedRuntime(client)

      const result = await runtime.check('camera[living_room].power = on')

      expect(result).toStrictEqual(
        failed(
          'validation_error',
          "Unknown device type 'camera'",
          FIX_PROGRAM_HINT,
        ),
      )
    })

    it('is blocked while an interaction is pending, without calling analyze', async () => {
      const { client, analyze, runDsl } = fakeClient(deviceSelection)
      const runtime = createGuardedRuntime(client)

      const result = await runtime.check('tv[living_room].power = on')

      expect(result).toStrictEqual({
        status: 'blocked',
        error: {
          code: 'interaction_pending',
          message: CHECK_BLOCKED_MESSAGE,
          interactionType: 'device_selection',
        },
      })
      expect(analyze).not.toHaveBeenCalled()
      expect(runDsl).not.toHaveBeenCalled()
    })

    it('returns core_error when analyze throws', async () => {
      const { client, analyze } = fakeClient(null)
      analyze.mockImplementation(() => {
        throw new Error('analyze boom')
      })
      const runtime = createGuardedRuntime(client)

      const result = await runtime.check('tv.power=on')

      expect(result).toStrictEqual(failed('core_error', 'analyze boom'))
    })
  })

  describe('respond guard', () => {
    it('is blocked with no_pending_interaction when nothing is pending', async () => {
      const { client, resumePending } = fakeClient(null)
      const runtime = createGuardedRuntime(client)

      const result = await runtime.respond(answer)

      expect(result).toStrictEqual({
        status: 'blocked',
        error: {
          code: 'no_pending_interaction',
          message: NO_PENDING_MESSAGE,
        },
      })
      expect(resumePending).not.toHaveBeenCalled()
    })

    it('maps a successful resume to completed', async () => {
      const { client, resumePending } = fakeClient(deviceSelection)
      resumePending.mockResolvedValue(runResult({ executed }))
      const runtime = createGuardedRuntime(client)

      const result = await runtime.respond(answer)

      expect(resumePending).toHaveBeenCalledWith(answer)
      expect(result).toStrictEqual({
        status: 'completed',
        result: { status: 'success', executed, errors: [] },
      })
    })
  })

  describe('retry budget', () => {
    it('aborts after maxFailedResumes wrong-type answers and cancels the interaction', async () => {
      const { client, resumePending, cancel } = fakeClient(
        confirmationInteraction,
      )
      resumePending.mockResolvedValue(
        errorResult(
          'interaction_type_mismatch',
          'Pending interaction is confirmation, got text_input.',
        ),
      )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      const first = await runtime.respond(wrongTypeAnswer)
      expect(first).toStrictEqual(
        failed(
          'interaction_type_mismatch',
          'Pending interaction is confirmation, got text_input.',
        ),
      )

      const second = await runtime.respond(wrongTypeAnswer)
      expect(second).toStrictEqual(
        failed(
          'interaction_type_mismatch',
          'Pending interaction is confirmation, got text_input.',
        ),
      )

      const third = await runtime.respond(wrongTypeAnswer)
      expect(third).toStrictEqual(failed('interaction_aborted', ABORT_MESSAGE))
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('defaults the budget to DEFAULT_MAX_FAILED_RESUMES', async () => {
      expect(DEFAULT_MAX_FAILED_RESUMES).toBe(2)

      const { client, resumePending, cancel } = fakeClient(deviceSelection)
      resumePending.mockResolvedValue(
        errorResult('unknown_device_id', 'Unknown device id: tv_unknown'),
      )
      const runtime = createGuardedRuntime(client)

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: tv_unknown'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: tv_unknown'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('interaction_aborted', ABORT_MESSAGE),
      )
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('resets the budget when a resume suspends again on a new interaction', async () => {
      const { client, resumePending, cancel } = fakeClient(deviceSelection)
      resumePending
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: a'),
        )
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: b'),
        )
        .mockResolvedValueOnce(
          runResult({
            status: 'awaiting_interaction',
            interaction: secondDeviceSelection,
          }),
        )
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: c'),
        )
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: d'),
        )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: a'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: b'),
      )

      const suspended = await runtime.respond(answer)
      if (suspended.status !== 'waiting_for_user') {
        throw new Error('expected waiting_for_user')
      }
      expect(suspended.interaction).toStrictEqual({
        type: 'device_selection',
        prompt: 'Multiple "light" devices found. Please select one:',
        choices: [
          { id: 'lamp_living_room', label: 'Living Room Lamp' },
          { id: 'lamp_kitchen', label: 'Kitchen Lamp' },
        ],
      })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: c'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: d'),
      )
      expect(cancel).not.toHaveBeenCalled()
    })

    it('resets the budget on a non-retryable error result', async () => {
      const { client, resumePending, cancel } = fakeClient(deviceSelection)
      resumePending
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: a'),
        )
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: b'),
        )
        .mockResolvedValueOnce(
          runResult({ status: 'error', errors: [{ message: 'boom' }] }),
        )
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: c'),
        )
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: d'),
        )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: a'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: b'),
      )

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('execution_failed', 'boom'),
      )

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: c'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: d'),
      )
      expect(cancel).not.toHaveBeenCalled()
    })

    it('resets the budget when runDsl succeeds', async () => {
      const { client, runDsl, resumePending, getPendingInteraction, cancel } =
        fakeClient(deviceSelection)
      resumePending.mockResolvedValue(
        errorResult('unknown_device_id', 'Unknown device id: x'),
      )
      runDsl.mockResolvedValue(runResult({ executed }))
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )

      getPendingInteraction.mockReturnValue(null)
      const run = await runtime.runDsl('tv[living_room].power = on')
      expect(run).toStrictEqual({
        status: 'completed',
        result: { status: 'success', executed, errors: [] },
      })

      getPendingInteraction.mockReturnValue(deviceSelection)
      const third = await runtime.respond(answer)
      expect(third).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect(cancel).not.toHaveBeenCalled()
    })

    it('leaves the budget unchanged when a check fails', async () => {
      const { client, analyze, resumePending, getPendingInteraction, cancel } =
        fakeClient(deviceSelection)
      resumePending.mockResolvedValue(
        errorResult('unknown_device_id', 'Unknown device id: x'),
      )
      analyze.mockReturnValue(
        validationErrorFeedback("Unknown device type 'camera'"),
      )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )

      getPendingInteraction.mockReturnValue(null)
      const check = await runtime.check('camera[living_room].power = on')
      expect(check).toStrictEqual(
        failed(
          'validation_error',
          "Unknown device type 'camera'",
          FIX_PROGRAM_HINT,
        ),
      )

      getPendingInteraction.mockReturnValue(deviceSelection)
      const third = await runtime.respond(answer)
      expect(third).toStrictEqual(failed('interaction_aborted', ABORT_MESSAGE))
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('resets the budget when a check succeeds', async () => {
      const { client, resumePending, getPendingInteraction, cancel } =
        fakeClient(deviceSelection)
      resumePending.mockResolvedValue(
        errorResult('unknown_device_id', 'Unknown device id: x'),
      )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )

      getPendingInteraction.mockReturnValue(null)
      const check = await runtime.check('tv[living_room].power = on')
      expect(check).toStrictEqual({ status: 'completed' })

      getPendingInteraction.mockReturnValue(deviceSelection)
      const third = await runtime.respond(answer)
      expect(third).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect(cancel).not.toHaveBeenCalled()
    })

    it('leaves the budget unchanged on core_error', async () => {
      const { client, resumePending, cancel } = fakeClient(deviceSelection)
      resumePending
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: a'),
        )
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: b'),
        )
        .mockResolvedValueOnce(
          errorResult('unknown_device_id', 'Unknown device id: c'),
        )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: a'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('core_error', 'boom'),
      )

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: b'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('interaction_aborted', ABORT_MESSAGE),
      )
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('leaves the budget unchanged when runDsl is blocked by a pending interaction', async () => {
      const { client, resumePending, cancel } = fakeClient(deviceSelection)
      resumePending.mockResolvedValue(
        errorResult('unknown_device_id', 'Unknown device id: x'),
      )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect((await runtime.runDsl('tv.power=on')).status).toBe('blocked')
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('interaction_aborted', ABORT_MESSAGE),
      )
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('leaves the budget unchanged when respond is blocked with no pending interaction', async () => {
      const { client, getPendingInteraction, resumePending, cancel } =
        fakeClient(deviceSelection)
      resumePending.mockResolvedValue(
        errorResult('unknown_device_id', 'Unknown device id: x'),
      )
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )

      getPendingInteraction.mockReturnValue(null)
      expect((await runtime.respond(answer)).status).toBe('blocked')
      getPendingInteraction.mockReturnValue(deviceSelection)

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('unknown_device_id', 'Unknown device id: x'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('interaction_aborted', ABORT_MESSAGE),
      )
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('swallows a cancel failure when aborting', async () => {
      const { client, resumePending, cancel } = fakeClient(deviceSelection)
      resumePending.mockResolvedValue(
        errorResult('unknown_device_id', 'Unknown device id: x'),
      )
      cancel.mockRejectedValue(new Error('cancel boom'))
      const runtime = createGuardedRuntime(client, { maxFailedResumes: 2 })

      await runtime.respond(answer)
      await runtime.respond(answer)

      const third = await runtime.respond(answer)
      expect(third).toStrictEqual(failed('interaction_aborted', ABORT_MESSAGE))
    })
  })

  describe('core_error', () => {
    it('returns core_error when resumePending throws', async () => {
      const { client, resumePending } = fakeClient(deviceSelection)
      resumePending.mockRejectedValue(new Error('boom'))
      const runtime = createGuardedRuntime(client)

      expect(await runtime.respond(answer)).toStrictEqual(
        failed('core_error', 'boom'),
      )
    })

    it('returns core_error when the client runDsl throws', async () => {
      const { client, runDsl } = fakeClient(null)
      runDsl.mockRejectedValue(new Error('boom'))
      const runtime = createGuardedRuntime(client)

      expect(await runtime.runDsl('tv.power=on')).toStrictEqual(
        failed('core_error', 'boom'),
      )
    })

    it('returns core_error when analyze throws during runDsl, without executing', async () => {
      const { client, analyze, runDsl } = fakeClient(null)
      analyze.mockImplementation(() => {
        throw new Error('analyze boom')
      })
      const runtime = createGuardedRuntime(client)

      const result = await runtime.runDsl('tv.power=on')

      expect(result).toStrictEqual(failed('core_error', 'analyze boom'))
      expect(runDsl).not.toHaveBeenCalled()
    })

    it('returns core_error when getPendingInteraction throws, on every entry point', async () => {
      const { client, getPendingInteraction, runDsl, analyze, resumePending } =
        fakeClient(null)
      getPendingInteraction.mockImplementation(() => {
        throw new Error('pending boom')
      })
      const runtime = createGuardedRuntime(client)

      expect(await runtime.runDsl('tv.power=on')).toStrictEqual(
        failed('core_error', 'pending boom'),
      )
      expect(await runtime.check('tv.power=on')).toStrictEqual(
        failed('core_error', 'pending boom'),
      )
      expect(await runtime.respond(answer)).toStrictEqual(
        failed('core_error', 'pending boom'),
      )
      expect(runDsl).not.toHaveBeenCalled()
      expect(analyze).not.toHaveBeenCalled()
      expect(resumePending).not.toHaveBeenCalled()
    })

    it('normalizes a nullish throw to core_error instead of crashing', async () => {
      const nullThrowing = fakeClient(deviceSelection)
      nullThrowing.resumePending.mockRejectedValue(null)
      const nullRuntime = createGuardedRuntime(nullThrowing.client)

      expect(await nullRuntime.respond(answer)).toStrictEqual(
        failed('core_error', 'null'),
      )

      const undefinedThrowing = fakeClient(deviceSelection)
      undefinedThrowing.resumePending.mockRejectedValue(undefined)
      const undefinedRuntime = createGuardedRuntime(undefinedThrowing.client)

      expect(await undefinedRuntime.respond(answer)).toStrictEqual(
        failed('core_error', 'undefined'),
      )
    })
  })
})
