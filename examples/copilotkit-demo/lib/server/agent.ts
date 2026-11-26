import { randomUUID } from 'node:crypto'
import { Observable } from 'rxjs'
import { compare } from 'fast-json-patch'
import { AbstractAgent, EventType } from '@ag-ui/client'
import type { BaseEvent, RunAgentInput } from '@ag-ui/client'
import type {
  Program,
  RunResult,
  SuggestionResponse,
  UserInteraction,
} from '@opennest/sdk'
import { DefaultExecutionTracer } from '@opennest/vm'
import type { DemoState, ProgramOrigin } from '../shared/state'
import type { House, HouseStore } from './house'
import { toInterrupt, toResumeAnswer } from './interrupt-mapping'
import { toLlmMessages } from './llm'
import type { LlmMessage, LlmPort } from './llm'
import {
  applyRunResult,
  applyVmEvent,
  beginProgram,
  cancelProgram,
  initialState,
  readDevices,
  withTrace,
} from './panel-state'
import { buildSystemPrompt } from './prompt'
import { TOOL_NAME } from './llm'

/** `run_homedsl` calls allowed per user turn (same budget as playground). */
const MAX_ATTEMPTS = 5
/** Minimum gap between two `STATE_DELTA` events during a run. */
const DELTA_INTERVAL_MS = 50

export type AgentErrorCode =
  | 'interrupt_pending'
  | 'unknown_interrupt'
  | 'llm_not_configured'
  | 'llm_error'
  | 'vm_error'

class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** `RunAgentInput.forwardedProps` understood by the agent. */
export type DemoForwardedProps =
  | { dsl: string }
  | {
      answerSuggestion: {
        suggestionId: string
        response: SuggestionResponse
      }
    }
  | { dismissSuggestion: { suggestionId: string } }

export interface OpenNestAgentDeps {
  houses: HouseStore
  llm: LlmPort | null
}

/** One run: the event sink plus the thread's house. */
interface RunContext {
  input: RunAgentInput
  house: House
  emit: (event: Record<string, unknown> & { type: EventType }) => void
  signal: AbortSignal
  /** Last state sent to the client, for JSON-patch deltas. */
  sent: DemoState
  lastDeltaAt: number
}

type Executed =
  | { kind: 'paused'; interaction: UserInteraction }
  | { kind: 'done'; result: RunResult }

/**
 * AG-UI agent driving one simulated house per thread. VM pauses become
 * standard interrupts and are resumed without the model.
 */
export class OpenNestAgent extends AbstractAgent {
  private deps: OpenNestAgentDeps

  constructor(deps: OpenNestAgentDeps) {
    super()
    this.deps = deps
  }

  override clone(): OpenNestAgent {
    const copy = super.clone() as OpenNestAgent
    copy.deps = this.deps
    return copy
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>(subscriber => {
      const controller = new AbortController()
      const { threadId, runId } = input
      const emit: RunContext['emit'] = event =>
        subscriber.next(event as unknown as BaseEvent)

      emit({ type: EventType.RUN_STARTED, threadId, runId })
      this.handle(input, emit, controller.signal)
        .catch((error: unknown) => {
          const code = error instanceof AgentError ? error.code : 'vm_error'
          const message = error instanceof Error ? error.message : String(error)
          emit({ type: EventType.RUN_ERROR, message, code })
        })
        .finally(() => subscriber.complete())

      return () => controller.abort()
    })
  }

  private async handle(
    input: RunAgentInput,
    emit: RunContext['emit'],
    signal: AbortSignal,
  ): Promise<void> {
    const house = await this.deps.houses.get(input.threadId)
    house.panel ??= initialState(
      await readDevices(house),
      this.deps.llm !== null,
    )
    const ctx: RunContext = {
      input,
      house,
      emit,
      signal,
      sent: house.panel,
      lastDeltaAt: 0,
    }
    emit({ type: EventType.STATE_SNAPSHOT, snapshot: house.panel })

    if (input.resume !== undefined && input.resume.length > 0) {
      return this.resume(ctx)
    }
    if (house.openInterrupt !== null) {
      throw new AgentError(
        'interrupt_pending',
        'Answer the open question before sending a new message.',
      )
    }

    const props = input.forwardedProps as Partial<
      Record<string, unknown>
    > | null
    if (props != null && 'dismissSuggestion' in props) {
      const { suggestionId } = props[
        'dismissSuggestion'
      ] as DemoForwardedProps & { suggestionId: string }
      house.client.dismissSuggestion(suggestionId)
      this.setPanel(ctx, {
        ...house.panel,
        suggestions: house.client.getSuggestions(),
      })
      this.flushDelta(ctx)
      return this.finish(ctx)
    }
    if (props != null && 'answerSuggestion' in props) {
      const { suggestionId, response } = props['answerSuggestion'] as {
        suggestionId: string
        response: SuggestionResponse
      }
      this.setPanel(ctx, {
        ...house.panel,
        program: { programId: '', dsl: '', origin: 'suggestion' },
        statements: [],
        trace: null,
        pending: null,
        suggestions: [],
      })
      house.tracer = new DefaultExecutionTracer()
      house.historyStart = house.client.getSession().history.length
      const executed = await this.execute(ctx, () =>
        house.client.answerSuggestion(suggestionId, response),
      )
      return this.afterDeterministic(ctx, executed, 'suggestion')
    }
    if (props != null && typeof props['dsl'] === 'string') {
      return this.runDirectDsl(ctx, props['dsl'])
    }
    return this.chat(ctx, toLlmMessages(input.messages), MAX_ATTEMPTS)
  }

  // ──── Cases ────

  private async runDirectDsl(ctx: RunContext, dsl: string): Promise<void> {
    const feedback = ctx.house.client.analyze(dsl)
    if (feedback.program === null || !feedback.ok) {
      const errors = [
        ...feedback.parseErrors.map(e => e.message),
        ...feedback.validationErrors.map(e => e.message),
      ]
      this.say(ctx, `That HomeDSL did not run: ${errors.join('; ')}`)
      return this.finish(ctx)
    }
    const program = feedback.program
    this.startProgram(ctx, program, dsl, 'dsl')
    const executed = await this.execute(ctx, () =>
      ctx.house.client.execute(program),
    )
    return this.afterDeterministic(ctx, executed, 'dsl')
  }

  private async resume(ctx: RunContext): Promise<void> {
    const { house } = ctx
    const entry = ctx.input.resume![0]!
    const open = house.openInterrupt
    const interaction = house.client.getPendingInteraction()
    if (
      open === null ||
      entry.interruptId !== open.id ||
      interaction === null
    ) {
      throw new AgentError(
        'unknown_interrupt',
        'This question is no longer open.',
      )
    }

    let executed: Executed
    if (entry.status === 'cancelled') {
      house.openInterrupt = null
      await this.execute(ctx, () => house.client.cancel())
      this.setPanel(ctx, cancelProgram(house.panel!))
      this.flushDelta(ctx)
      if (open.origin !== 'chat' || open.toolCall === undefined) {
        this.say(ctx, 'Cancelled.')
        return this.finish(ctx)
      }
      const content = JSON.stringify({
        status: 'cancelled',
        message:
          'The user cancelled the question; the rest of the program did not run.',
      })
      this.emitToolResult(ctx, open.toolCall.id, content)
      return this.chat(
        ctx,
        [
          ...toLlmMessages(ctx.input.messages),
          { role: 'assistant', toolCall: open.toolCall },
          { role: 'tool', toolCallId: open.toolCall.id, content },
        ],
        open.attemptsLeft,
      )
    } else {
      const mapped = toResumeAnswer(interaction, entry.payload)
      if (!mapped.ok) return this.interrupt(ctx, interaction, mapped.message)
      house.openInterrupt = null
      executed = await this.execute(ctx, () =>
        house.client.resumePending(mapped.answer),
      )
      if (
        executed.kind === 'done' &&
        executed.result.status === 'error' &&
        executed.result.errors[0]?.code === 'invalid_response'
      ) {
        house.openInterrupt = open
        return this.interrupt(
          ctx,
          interaction,
          executed.result.errors[0].message,
        )
      }
    }

    if (open.origin !== 'chat' || open.toolCall === undefined) {
      if (executed.kind === 'paused') {
        house.openInterrupt = { ...open, id: executed.interaction.id }
        return this.interrupt(ctx, executed.interaction)
      }
      return this.afterDeterministic(ctx, executed, open.origin)
    }

    const toolCall = open.toolCall
    if (executed.kind === 'paused') {
      house.openInterrupt = { ...open, id: executed.interaction.id }
      return this.interrupt(ctx, executed.interaction)
    }
    const content = this.toolResult(ctx, executed.result)
    this.emitToolResult(ctx, toolCall.id, content)
    const messages: LlmMessage[] = [
      ...toLlmMessages(ctx.input.messages),
      { role: 'assistant', toolCall },
      { role: 'tool', toolCallId: toolCall.id, content },
    ]
    return this.chat(ctx, messages, open.attemptsLeft)
  }

  private async chat(
    ctx: RunContext,
    messages: LlmMessage[],
    attemptsLeft: number,
  ): Promise<void> {
    const { llm } = this.deps
    if (llm === null) {
      throw new AgentError(
        'llm_not_configured',
        'No language model is configured. Set OPENAI_API_KEY or OPENAI_BASE_URL, or use direct HomeDSL in Advanced mode.',
      )
    }
    const system = buildSystemPrompt(ctx.house.client)
    const history = [...messages]
    let left = attemptsLeft

    for (;;) {
      const { messageId, calls } = await this.streamTurn(
        ctx,
        llm,
        system,
        history,
      )
      if (calls.length === 0) return this.finish(ctx)

      for (const call of calls) {
        this.emitToolCall(ctx, call, messageId)
        if (left <= 0) {
          const content = JSON.stringify({
            status: 'error',
            errors: ['Too many attempts for this request.'],
          })
          this.emitToolResult(ctx, call.id, content)
          history.push({ role: 'assistant', toolCall: call })
          history.push({ role: 'tool', toolCallId: call.id, content })
          continue
        }
        left -= 1
        const content = await this.runToolCall(ctx, call, left)
        if (content === null) return // paused: interrupt already emitted
        history.push({ role: 'assistant', toolCall: call })
        history.push({ role: 'tool', toolCallId: call.id, content })
      }

      if (left <= 0) {
        this.say(
          ctx,
          "I couldn't turn that into a valid HomeDSL program. Try rephrasing it.",
        )
        return this.finish(ctx)
      }
    }
  }

  /** Runs one `run_homedsl` call; null when the VM paused. */
  private async runToolCall(
    ctx: RunContext,
    call: { id: string; dsl: string },
    attemptsLeft: number,
  ): Promise<string | null> {
    const feedback = ctx.house.client.analyze(call.dsl)
    if (feedback.program === null || !feedback.ok) {
      const content = JSON.stringify({
        status: 'error',
        errors: [
          ...feedback.parseErrors.map(e => `line ${e.line}: ${e.message}`),
          ...feedback.validationErrors.map(e => e.message),
        ],
      })
      this.emitToolResult(ctx, call.id, content)
      return content
    }
    const program = feedback.program
    this.startProgram(ctx, program, call.dsl, 'chat')
    const executed = await this.execute(ctx, () =>
      ctx.house.client.execute(program),
    )
    if (executed.kind === 'paused') {
      ctx.house.openInterrupt = {
        id: executed.interaction.id,
        origin: 'chat',
        toolCall: call,
        attemptsLeft,
      }
      this.interrupt(ctx, executed.interaction)
      return null
    }
    const content = this.toolResult(ctx, executed.result)
    this.emitToolResult(ctx, call.id, content)
    return content
  }

  // ──── VM execution ────

  private startProgram(
    ctx: RunContext,
    program: Program,
    dsl: string,
    origin: ProgramOrigin,
  ): void {
    ctx.house.tracer = new DefaultExecutionTracer()
    ctx.house.historyStart = ctx.house.client.getSession().history.length
    this.setPanel(ctx, beginProgram(ctx.house.panel!, program, dsl, origin))
    this.flushDelta(ctx)
  }

  /** Runs one SDK call while streaming VM events as state deltas. */
  private async execute(
    ctx: RunContext,
    run: () => Promise<RunResult>,
  ): Promise<Executed> {
    const { house } = ctx
    const tracer = house.tracer
    const unsubscribe = house.events.subscribe(event => {
      tracer?.consume(event)
      this.setPanel(ctx, applyVmEvent(house.panel!, event))
      this.maybeDelta(ctx)
    })
    let result: RunResult
    try {
      result = await run()
    } finally {
      unsubscribe()
    }
    let panel = applyRunResult(
      house.panel!,
      result,
      house.client.getSession().programId,
      house.historyStart,
    )
    if (tracer !== null) panel = withTrace(panel, tracer.getTrace())
    this.setPanel(ctx, panel)
    this.flushDelta(ctx)
    if (result.status === 'awaiting_interaction' && result.interaction) {
      return { kind: 'paused', interaction: result.interaction }
    }
    return { kind: 'done', result }
  }

  /** Ends a run without the model: a short fixed reply. */
  private afterDeterministic(
    ctx: RunContext,
    executed: Executed,
    origin: ProgramOrigin,
  ): void {
    if (executed.kind === 'paused') {
      ctx.house.openInterrupt = {
        id: executed.interaction.id,
        origin,
        attemptsLeft: 0,
      }
      return this.interrupt(ctx, executed.interaction)
    }
    const { result } = executed
    const first = result.errors[0]
    this.say(ctx, first === undefined ? 'Done.' : `Not done: ${first.message}`)
    return this.finish(ctx)
  }

  /** Compact JSON the model reads as the tool result. */
  private toolResult(ctx: RunContext, result: RunResult): string {
    const panel = ctx.house.panel!
    return JSON.stringify({
      status: result.status,
      statements: panel.statements.map(s => ({
        action: s.summary,
        status: s.status,
        ...(s.reason !== undefined ? { reason: s.reason } : {}),
      })),
      errors: result.errors.map(e => e.message),
      suggestions: (result.suggestions ?? []).map(s => s.question.message),
    })
  }

  // ──── Events ────

  private async streamTurn(
    ctx: RunContext,
    llm: LlmPort,
    system: string,
    messages: LlmMessage[],
  ): Promise<{
    messageId: string | null
    calls: { id: string; dsl: string }[]
  }> {
    let messageId: string | null = null
    const calls: { id: string; dsl: string }[] = []
    try {
      for await (const chunk of llm.turn({
        system,
        messages,
        signal: ctx.signal,
      })) {
        if (chunk.type === 'text') {
          if (messageId === null) {
            messageId = randomUUID()
            ctx.emit({
              type: EventType.TEXT_MESSAGE_START,
              messageId,
              role: 'assistant',
            })
          }
          ctx.emit({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta: chunk.delta,
          })
        } else {
          calls.push({ id: chunk.id, dsl: chunk.dsl })
        }
      }
    } catch (error) {
      if (messageId !== null) {
        ctx.emit({ type: EventType.TEXT_MESSAGE_END, messageId })
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new AgentError('llm_error', `The language model failed: ${message}`)
    }
    if (messageId !== null) {
      ctx.emit({ type: EventType.TEXT_MESSAGE_END, messageId })
    }
    return { messageId, calls }
  }

  private emitToolCall(
    ctx: RunContext,
    call: { id: string; dsl: string },
    parentMessageId: string | null,
  ): void {
    ctx.emit({
      type: EventType.TOOL_CALL_START,
      toolCallId: call.id,
      toolCallName: TOOL_NAME,
      ...(parentMessageId !== null ? { parentMessageId } : {}),
    })
    ctx.emit({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: call.id,
      delta: JSON.stringify({ dsl: call.dsl }),
    })
    ctx.emit({ type: EventType.TOOL_CALL_END, toolCallId: call.id })
  }

  private emitToolResult(
    ctx: RunContext,
    toolCallId: string,
    content: string,
  ): void {
    ctx.emit({
      type: EventType.TOOL_CALL_RESULT,
      messageId: randomUUID(),
      toolCallId,
      content,
      role: 'tool',
    })
  }

  private say(ctx: RunContext, text: string): void {
    const messageId = randomUUID()
    ctx.emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: 'assistant',
    })
    ctx.emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text })
    ctx.emit({ type: EventType.TEXT_MESSAGE_END, messageId })
  }

  private interrupt(
    ctx: RunContext,
    interaction: UserInteraction,
    error?: string,
  ): void {
    const { house } = ctx
    const toolCallId = house.openInterrupt?.toolCall?.id
    this.setPanel(ctx, {
      ...house.panel!,
      pending: {
        interruptId: interaction.id,
        interaction,
        ...(error !== undefined ? { error } : {}),
      },
    })
    // AG-UI: emit the state needed for resume before the interrupt.
    ctx.emit({ type: EventType.STATE_SNAPSHOT, snapshot: house.panel })
    ctx.sent = house.panel!
    ctx.emit({
      type: EventType.RUN_FINISHED,
      threadId: ctx.input.threadId,
      runId: ctx.input.runId,
      outcome: {
        type: 'interrupt',
        interrupts: [
          toInterrupt(interaction, {
            ...(toolCallId !== undefined ? { toolCallId } : {}),
            ...(error !== undefined ? { error } : {}),
          }),
        ],
      },
    })
  }

  private finish(ctx: RunContext): void {
    this.flushDelta(ctx)
    ctx.emit({
      type: EventType.RUN_FINISHED,
      threadId: ctx.input.threadId,
      runId: ctx.input.runId,
      outcome: { type: 'success' },
    })
  }

  // ──── State sync ────

  private setPanel(ctx: RunContext, panel: DemoState): void {
    ctx.house.panel = panel
  }

  private maybeDelta(ctx: RunContext): void {
    if (Date.now() - ctx.lastDeltaAt >= DELTA_INTERVAL_MS) this.flushDelta(ctx)
  }

  private flushDelta(ctx: RunContext): void {
    const next = ctx.house.panel!
    if (next === ctx.sent) return
    const delta = compare(ctx.sent, next)
    ctx.sent = next
    ctx.lastDeltaAt = Date.now()
    if (delta.length > 0) ctx.emit({ type: EventType.STATE_DELTA, delta })
  }
}
