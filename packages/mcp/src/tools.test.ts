import { describe, expect, it } from 'vitest'
import { MockDriver } from '@opennest/devices'
import { OpenNestClient, createAsk, defineSuggestion } from '@opennest/sdk'
import { createConfirmationMiddleware } from '@opennest/vm'
import type { Device, Middleware } from '@opennest/vm'
import { createGuardedRuntime } from './runtime.js'
import {
  answerSuggestionTool,
  cancelTool,
  getSessionTool,
  respondTool,
  runDslTool,
} from './tools.js'
import type { ToolDeps } from './tools.js'
import { toInteractionPrompt } from './result.js'
import { toSessionSummary } from './session.js'

// getSession() returns the live session, so snapshot a detached view.
function snapshot(deps: ToolDeps) {
  const session = deps.client.getSession()
  return structuredClone({
    summary: toSessionSummary(session),
    cursor: session.cursor,
    historyLength: session.history.length,
  })
}

async function makeDeps(
  confirm: (kind: string) => boolean = () => true,
): Promise<ToolDeps & { driver: MockDriver }> {
  const driver = new MockDriver()
  await driver.init({})
  const devices: Device[] = [
    {
      id: 'tv_living_room',
      type: 'tv',
      room: 'living_room',
      name: 'Living Room TV',
      driver,
      driverConfig: {},
    },
  ]
  driver.seed('tv_living_room', { power: false, volume: 15 })
  const client = new OpenNestClient({
    devices,
    middleware: [
      createConfirmationMiddleware({
        requireConfirmation: action => confirm(action.kind),
      }),
    ],
  })
  return { client, runtime: createGuardedRuntime(client), driver }
}

function runtimeWaiting(deps: ToolDeps) {
  const pending = deps.client.getPendingInteraction()
  if (pending === null) throw new Error('expected a pending interaction')
  return Promise.resolve(toInteractionPrompt(pending))
}

class FailingDriver extends MockDriver {
  override setProperty(): Promise<void> {
    return Promise.reject(new Error('write refused'))
  }
  override executeAction(): Promise<void> {
    return Promise.reject(new Error('action exploded'))
  }
}

async function makeFailingDeps(): Promise<ToolDeps> {
  const driver = new FailingDriver()
  await driver.init({})
  driver.seed('tv_living_room', { power: false })
  const devices: Device[] = [
    {
      id: 'tv_living_room',
      type: 'tv',
      room: 'living_room',
      name: 'Living Room TV',
      driver,
      driverConfig: {},
    },
  ]
  const client = new OpenNestClient({ devices })
  return { client, runtime: createGuardedRuntime(client) }
}

describe('executed scoping (F1)', () => {
  const writesOnly = (kind: string) => kind === 'set_property'

  it('reports exactly one entry for the same program run three times', async () => {
    const deps = await makeDeps(writesOnly)
    for (let i = 0; i < 3; i++) {
      const r = await runDslTool(deps, { dsl: 'tv[living_room].power?' })
      if (r.status !== 'completed') throw new Error('expected completed')
      expect(r.result?.executed).toHaveLength(1)
    }
  })

  it('a suspended program reports only its own entries after respond', async () => {
    const deps = await makeDeps(writesOnly)
    await runDslTool(deps, { dsl: 'tv[living_room].volume?' })
    const waiting = await runDslTool(deps, {
      dsl: 'tv[living_room].volume?\ntv[living_room].power = on',
    })
    expect(waiting.status).toBe('waiting_for_user')
    const done = await respondTool(deps, {
      response: { type: 'confirmation', confirmed: true },
    })
    if (done.status !== 'completed') throw new Error('expected completed')
    expect(done.result?.executed).toHaveLength(2)
  })

  it('resets the baseline after cancel', async () => {
    const deps = await makeDeps(writesOnly)
    await runDslTool(deps, { dsl: 'tv[living_room].volume?' })
    await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    await cancelTool(deps)
    const r = await runDslTool(deps, { dsl: 'tv[living_room].volume?' })
    if (r.status !== 'completed') throw new Error('expected completed')
    expect(r.result?.executed).toHaveLength(1)
  })
})

describe('device failures (F2)', () => {
  it('reports a throwing action as deviceFailures', async () => {
    const deps = await makeFailingDeps()
    const r = await runDslTool(deps, { dsl: 'tv[living_room].play()' })
    expect(r).toMatchObject({
      status: 'completed',
      deviceFailures: [
        { deviceId: 'tv_living_room', message: 'action exploded' },
      ],
    })
  })

  it('reports a throwing property write as deviceFailures (outcomes path)', async () => {
    const deps = await makeFailingDeps()
    const r = await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    expect(r).toMatchObject({
      status: 'completed',
      result: { errors: [] },
      deviceFailures: [
        { deviceId: 'tv_living_room', message: 'write refused' },
      ],
    })
  })
})

describe('tool handlers', () => {
  it('runs the full confirm loop', async () => {
    const deps = await makeDeps()
    const waiting = await runDslTool(deps, {
      dsl: 'tv[living_room].power = on',
    })
    expect(waiting.status).toBe('waiting_for_user')
    if (waiting.status !== 'waiting_for_user') return
    expect(waiting.interaction.type).toBe('confirmation')
    expect(waiting.interaction.prompt).toBeTruthy()

    const done = await respondTool(deps, {
      response: { type: 'confirmation', confirmed: true },
    })
    expect(done.status).toBe('completed')
    if (done.status !== 'completed') return
    expect(done.result?.executed).toHaveLength(1)
    expect(done).not.toHaveProperty('deviceFailures')
  })

  it('respond without a pending interaction is blocked', async () => {
    const deps = await makeDeps()
    const result = await respondTool(deps, {
      response: { type: 'confirmation', confirmed: true },
    })
    expect(result).toMatchObject({
      status: 'blocked',
      error: { code: 'no_pending_interaction' },
    })
  })

  it('run_dsl during a pending interaction is blocked', async () => {
    const deps = await makeDeps()
    await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    const result = await runDslTool(deps, {
      dsl: 'tv[living_room].power = off',
    })
    expect(result).toMatchObject({
      status: 'blocked',
      error: { code: 'interaction_pending' },
    })
  })

  it('dryRun on an invalid program fails with validation_error and no side effects', async () => {
    const deps = await makeDeps()
    const before = snapshot(deps)
    const result = await runDslTool(deps, {
      dsl: 'tv[bedroom].power = on',
      dryRun: true,
    })
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'validation_error' },
    })
    expect(snapshot(deps)).toEqual(before)
  })

  it('dryRun on a valid program does not execute or suspend', async () => {
    const deps = await makeDeps()
    const result = await runDslTool(deps, {
      dsl: 'tv[living_room].power = on',
      dryRun: true,
    })
    expect(result).toEqual({ status: 'completed' })
    expect(deps.client.getPendingInteraction()).toBeNull()
    expect(await deps.driver.getProperty('tv_living_room', 'power')).toBe(false)
  })

  it('cancel and get_session around a suspension', async () => {
    const deps = await makeDeps()
    await runDslTool(deps, { dsl: 'tv[living_room].power = on' })

    const during = getSessionTool(deps)
    expect(during.status).toBe('completed')
    if (during.status !== 'completed') return
    expect(during.session?.pendingInteraction).not.toBeNull()
    // Verbatim core prompt, identical to the waiting_for_user result.
    const waiting = await runtimeWaiting(deps)
    expect(during.session?.pendingInteraction).toEqual(waiting)

    expect((await cancelTool(deps)).status).toBe('completed')

    const after = getSessionTool(deps)
    if (after.status !== 'completed') throw new Error('expected completed')
    expect(after.session?.pendingInteraction).toBeNull()
  })

  it('cancel and get_session never throw', async () => {
    const deps = await makeDeps()
    const boom = new Error('boom')
    const broken: ToolDeps = {
      ...deps,
      client: {
        ...deps.client,
        cancel: () => Promise.reject(boom),
        getSession: () => {
          throw boom
        },
      } as unknown as ToolDeps['client'],
    }
    expect(await cancelTool(broken)).toEqual({
      status: 'failed',
      error: { code: 'core_error', message: 'boom' },
    })
    expect(getSessionTool(broken)).toEqual({
      status: 'failed',
      error: { code: 'core_error', message: 'boom' },
    })
  })
})

describe('ask questions end to end', () => {
  type AskQuestionInput = Parameters<ReturnType<typeof createAsk>>[1]

  async function makeAskDeps(
    question: AskQuestionInput,
    maxFailedResumes?: number,
  ): Promise<ToolDeps & { driver: MockDriver }> {
    const driver = new MockDriver()
    await driver.init({})
    const devices: Device[] = [
      {
        id: 'tv_living_room',
        type: 'tv',
        room: 'living_room',
        name: 'Living Room TV',
        driver,
        driverConfig: {},
      },
    ]
    driver.seed('tv_living_room', { power: false, volume: 15, source: 'hdmi1' })
    const ask = createAsk()
    const middleware: Middleware = async (ctx, next) => {
      if (ctx.action.kind === 'set_property') {
        const answer = ask(ctx, question)
        ctx.action.value =
          typeof answer === 'number'
            ? { kind: 'number', value: answer }
            : { kind: 'string', value: answer }
      }
      return next()
    }
    const client = new OpenNestClient({ devices, middleware: [middleware] })
    return {
      client,
      runtime: createGuardedRuntime(
        client,
        maxFailedResumes === undefined ? undefined : { maxFailedResumes },
      ),
      driver,
    }
  }

  const numberQuestion: AskQuestionInput = {
    key: 'volume',
    type: 'number_input',
    message: 'Volume?',
    min: 0,
    max: 100,
  }

  it('completes a choice question end to end', async () => {
    const deps = await makeAskDeps({
      key: 'source',
      type: 'choice',
      message: 'Which source?',
      options: [
        { value: 'hdmi1', label: 'HDMI 1' },
        { value: 'hdmi2', label: 'HDMI 2' },
      ],
    })
    const waiting = await runDslTool(deps, {
      dsl: 'tv[living_room].source = hdmi1',
    })
    expect(waiting).toEqual({
      status: 'waiting_for_user',
      interaction: {
        type: 'choice',
        prompt: 'Which source?',
        choices: [
          { id: 'hdmi1', label: 'HDMI 1' },
          { id: 'hdmi2', label: 'HDMI 2' },
        ],
      },
    })
    const done = await respondTool(deps, {
      response: { type: 'choice', value: 'hdmi2' },
    })
    expect(done.status).toBe('completed')
    expect(await deps.driver.getProperty('tv_living_room', 'source')).toBe(
      'hdmi2',
    )
  })

  it('completes a number_input question end to end', async () => {
    const deps = await makeAskDeps(numberQuestion)
    const waiting = await runDslTool(deps, {
      dsl: 'tv[living_room].volume = 1',
    })
    expect(waiting).toEqual({
      status: 'waiting_for_user',
      interaction: {
        type: 'number_input',
        prompt: 'Volume?',
        min: 0,
        max: 100,
      },
    })
    const done = await respondTool(deps, {
      response: { type: 'number_input', value: 42 },
    })
    expect(done.status).toBe('completed')
    expect(await deps.driver.getProperty('tv_living_room', 'volume')).toBe(42)
  })

  it('completes a text_input question end to end', async () => {
    const deps = await makeAskDeps({
      key: 'source',
      type: 'text_input',
      message: 'Source name?',
      placeholder: 'hdmi1',
    })
    const waiting = await runDslTool(deps, {
      dsl: 'tv[living_room].source = hdmi1',
    })
    expect(waiting).toEqual({
      status: 'waiting_for_user',
      interaction: {
        type: 'text_input',
        prompt: 'Source name?',
        placeholder: 'hdmi1',
      },
    })
    const done = await respondTool(deps, {
      response: { type: 'text_input', text: '  hdmi3  ' },
    })
    expect(done.status).toBe('completed')
    expect(await deps.driver.getProperty('tv_living_room', 'source')).toBe(
      'hdmi3',
    )
  })

  it('retries an invalid number answer then completes', async () => {
    const deps = await makeAskDeps(numberQuestion)
    await runDslTool(deps, { dsl: 'tv[living_room].volume = 1' })

    const invalid = await respondTool(deps, {
      response: { type: 'number_input', value: 500 },
    })
    expect(invalid).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_response' },
    })
    const during = getSessionTool(deps)
    if (during.status !== 'completed') throw new Error('expected completed')
    expect(during.session?.pendingInteraction).toMatchObject({
      type: 'number_input',
    })
    expect(await deps.driver.getProperty('tv_living_room', 'volume')).toBe(15)

    const done = await respondTool(deps, {
      response: { type: 'number_input', value: 30 },
    })
    expect(done.status).toBe('completed')
    expect(await deps.driver.getProperty('tv_living_room', 'volume')).toBe(30)
  })

  it('aborts after too many invalid answers', async () => {
    const deps = await makeAskDeps(numberQuestion, 2)
    await runDslTool(deps, { dsl: 'tv[living_room].volume = 1' })
    const invalid = { type: 'number_input' as const, value: 500 }

    for (let i = 0; i < 2; i++) {
      expect(await respondTool(deps, { response: invalid })).toMatchObject({
        status: 'failed',
        error: { code: 'invalid_response' },
      })
    }
    expect(await respondTool(deps, { response: invalid })).toMatchObject({
      status: 'failed',
      error: { code: 'interaction_aborted' },
    })
    expect(deps.client.getPendingInteraction()).toBeNull()
    const after = getSessionTool(deps)
    if (after.status !== 'completed') throw new Error('expected completed')
    expect(after.session?.pendingInteraction).toBeNull()
    expect(await deps.driver.getProperty('tv_living_room', 'volume')).toBe(15)
  })
})

describe('suggestions', () => {
  let n = 0
  const volumeFollowUp = (name: string) =>
    defineSuggestion(name, {
      apply: (answer, devices) =>
        devices.map(device => ({
          kind: 'set_property' as const,
          device,
          property: 'volume',
          value: {
            kind: 'number' as const,
            value:
              typeof answer === 'number' ? answer : answer === 'low' ? 5 : 80,
          },
        })),
    })

  async function makeSuggestionDeps(
    questions: Parameters<ReturnType<typeof volumeFollowUp>['suggest']>[1][],
    options: { confirmVolume?: boolean; maxFailedResumes?: number } = {},
  ) {
    const defs = questions.map(() => volumeFollowUp(`mcp_suggestion_${++n}`))
    const suggest: Middleware = async (ctx, next) => {
      if (
        ctx.action.kind === 'set_property' &&
        ctx.action.property === 'power'
      ) {
        questions.forEach((question, i) => defs[i]!.suggest(ctx, question))
      }
      return next()
    }
    const driver = new MockDriver()
    await driver.init({})
    driver.seed('tv_living_room', { power: false, volume: 15 })
    const devices: Device[] = [
      {
        id: 'tv_living_room',
        type: 'tv',
        room: 'living_room',
        name: 'Living Room TV',
        driver,
        driverConfig: {},
      },
    ]
    const client = new OpenNestClient({
      devices,
      middleware: [
        suggest,
        createConfirmationMiddleware({
          requireConfirmation: action =>
            options.confirmVolume === true &&
            action.kind === 'set_property' &&
            action.property === 'volume',
        }),
      ],
    })
    const deps: ToolDeps = {
      client,
      runtime: createGuardedRuntime(client, {
        ...(options.maxFailedResumes !== undefined
          ? { maxFailedResumes: options.maxFailedResumes }
          : {}),
      }),
    }
    return { deps, driver }
  }

  const level = {
    key: 'level',
    type: 'number_input' as const,
    message: 'Volume?',
    min: 0,
    max: 100,
  }
  const mode = {
    key: 'mode',
    type: 'choice' as const,
    message: 'Mode?',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ],
  }

  it('run_dsl completed result lists suggestions', async () => {
    const { deps } = await makeSuggestionDeps([mode])
    const r = await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    expect(r).toMatchObject({
      status: 'completed',
      suggestions: [
        {
          type: 'choice',
          prompt: 'Mode?',
          devices: ['Living Room TV'],
          choices: [
            { id: 'low', label: 'Low' },
            { id: 'high', label: 'High' },
          ],
        },
      ],
    })
    if (r.status !== 'completed') return
    expect(typeof r.suggestions![0]!.id).toBe('string')
    expect(JSON.stringify(r.suggestions)).not.toContain('"key"')
  })

  it('answer_suggestion completes a choice follow-up', async () => {
    const { deps, driver } = await makeSuggestionDeps([mode])
    const first = await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    if (first.status !== 'completed') throw new Error('expected completed')
    const done = await answerSuggestionTool(deps, {
      suggestionId: first.suggestions![0]!.id,
      answer: { type: 'choice', value: 'high' },
    })
    expect(done.status).toBe('completed')
    if (done.status !== 'completed') return
    expect(await driver.getProperty('tv_living_room', 'volume')).toBe(80)
    // scoped to the follow-up only, not the whole history
    expect(done.result?.executed).toHaveLength(1)
    expect(done.result?.executed[0]?.origin).toEqual({
      suggestionId: first.suggestions![0]!.id,
    })
    expect(done).not.toHaveProperty('suggestions')
  })

  it('answer_suggestion pauses on a confirmation and respond completes it', async () => {
    const { deps, driver } = await makeSuggestionDeps([level], {
      confirmVolume: true,
    })
    const first = await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    if (first.status !== 'completed') throw new Error('expected completed')
    const waiting = await answerSuggestionTool(deps, {
      suggestionId: first.suggestions![0]!.id,
      answer: { type: 'number_input', value: 30 },
    })
    expect(waiting).toMatchObject({
      status: 'waiting_for_user',
      interaction: { type: 'confirmation' },
    })
    const done = await respondTool(deps, {
      response: { type: 'confirmation', confirmed: true },
    })
    expect(done.status).toBe('completed')
    if (done.status !== 'completed') return
    expect(done.result?.executed).toHaveLength(1)
    expect(await driver.getProperty('tv_living_room', 'volume')).toBe(30)
  })

  it('retries an invalid suggestion answer then completes', async () => {
    const { deps, driver } = await makeSuggestionDeps([level])
    const first = await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    if (first.status !== 'completed') throw new Error('expected completed')
    const suggestionId = first.suggestions![0]!.id
    const bad = await answerSuggestionTool(deps, {
      suggestionId,
      answer: { type: 'number_input', value: 500 },
    })
    expect(bad).toMatchObject({
      status: 'failed',
      error: { code: 'invalid_response' },
    })
    const good = await answerSuggestionTool(deps, {
      suggestionId,
      answer: { type: 'number_input', value: 40 },
    })
    expect(good.status).toBe('completed')
    expect(await driver.getProperty('tv_living_room', 'volume')).toBe(40)
  })

  it('aborts only that suggestion after too many invalid answers', async () => {
    const { deps } = await makeSuggestionDeps([level, mode])
    const first = await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    if (first.status !== 'completed') throw new Error('expected completed')
    const [levelPrompt, modePrompt] = first.suggestions!
    const historyBefore = deps.client.getSession().history.length
    const answer = {
      suggestionId: levelPrompt!.id,
      answer: { type: 'number_input' as const, value: 500 },
    }
    for (let i = 0; i < 2; i++) {
      const r = await answerSuggestionTool(deps, answer)
      expect(r).toMatchObject({ error: { code: 'invalid_response' } })
    }
    const aborted = await answerSuggestionTool(deps, answer)
    expect(aborted).toMatchObject({
      status: 'failed',
      error: { code: 'suggestion_aborted' },
    })
    const session = getSessionTool(deps)
    if (session.status !== 'completed') throw new Error('expected completed')
    expect(session.session?.suggestions?.map(s => s.id)).toEqual([
      modePrompt!.id,
    ])
    expect(deps.client.getSession().history).toHaveLength(historyBefore)
  })

  it('answer_suggestion on a stale id fails with suggestion_not_found', async () => {
    const { deps } = await makeSuggestionDeps([mode])
    const first = await runDslTool(deps, { dsl: 'tv[living_room].power = on' })
    if (first.status !== 'completed') throw new Error('expected completed')
    const staleId = first.suggestions![0]!.id
    await runDslTool(deps, { dsl: 'tv[living_room].volume?' })
    const r = await answerSuggestionTool(deps, {
      suggestionId: staleId,
      answer: { type: 'choice', value: 'low' },
    })
    expect(r).toMatchObject({
      status: 'failed',
      error: { code: 'suggestion_not_found' },
    })
  })
})
