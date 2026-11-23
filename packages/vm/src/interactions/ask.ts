import type { MiddlewareContext } from '../middleware/types.js'
import { PauseSignal } from '../middleware/types.js'
import type {
  ChoiceInteraction,
  NumberInputInteraction,
  TextInputInteraction,
} from './types.js'

export type AskScope = 'device' | 'statement'

export type AskQuestion =
  | {
      key: string
      type: 'text_input'
      message: string
      placeholder?: string
      scope?: AskScope
    }
  | {
      key: string
      type: 'number_input'
      message: string
      min?: number
      max?: number
      scope?: AskScope
    }
  | {
      key: string
      type: 'choice'
      message: string
      options: { value: string; label: string }[]
      scope?: AskScope
    }

/** `number_input` → `number`; `text_input` and `choice` (the option value) → `string`. */
export type AskAnswer<Q extends AskQuestion> = Q extends {
  type: 'number_input'
}
  ? number
  : string

export type AskFn = <Q extends AskQuestion>(
  ctx: MiddlewareContext,
  question: Q,
) => AskAnswer<Q>

const MAX_PARTITIONS = 64

/**
 * In-memory answers, partitioned by `programId` so a later run never sees
 * them and one `ask` can be shared by several sessions. Keeps the
 * {@link MAX_PARTITIONS} most recently used partitions; `get` and `set` touch
 * the partition, so a paused run (replayed on each resume) stays recent.
 */
export class AskStore {
  private readonly partitions = new Map<string, Map<string, string | number>>()

  get(programId: string, answerKey: string): string | number | undefined {
    const partition = this.touch(programId)
    return partition?.get(answerKey)
  }

  set(programId: string, answerKey: string, value: string | number): void {
    let partition = this.touch(programId)
    if (!partition) {
      partition = new Map()
      this.partitions.set(programId, partition)
      this.evict()
    }
    partition.set(answerKey, value)
  }

  private touch(programId: string): Map<string, string | number> | undefined {
    const partition = this.partitions.get(programId)
    if (partition) {
      // Map keeps insertion order: re-inserting moves it to the most recent end.
      this.partitions.delete(programId)
      this.partitions.set(programId, partition)
    }
    return partition
  }

  private evict(): void {
    while (this.partitions.size > MAX_PARTITIONS) {
      const oldest = this.partitions.keys().next()
      if (oldest.done) return
      this.partitions.delete(oldest.value)
    }
  }
}

/** Context stored in `session.pendingInteraction` for a question raised by `ask()`. */
export interface AskContext {
  kind: 'ask'
  store: AskStore
  programId: string
  answerKey: string
  question: AskQuestion
}

export function isAskContext(value: unknown): value is AskContext {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<AskContext>
  return (
    v.kind === 'ask' &&
    v.store instanceof AskStore &&
    typeof v.programId === 'string' &&
    typeof v.answerKey === 'string' &&
    typeof v.question === 'object' &&
    v.question !== null
  )
}

let nextId = 0

function generateId(): string {
  return `interaction_${++nextId}_${Date.now().toString(36)}`
}

/**
 * Returns an `ask` function bound to its own answer store (one per middleware
 * instance). `ask(ctx, question)` returns the answer already given in this
 * program run, or throws a `PauseSignal` with the question; the pipeline is
 * replayed on resume and `ask` then returns the answer.
 *
 * Answers are keyed by statement index (`session.cursor`), device id (unless
 * `scope: 'statement'`) and `question.key`. Known limitation: statements
 * nested in one `@if` share a statement index, so two nested actions on the
 * same device asking the same key share one answer.
 *
 * Invalid questions (empty key, `choice` without options or with duplicate
 * option values, `min > max`) throw a plain `Error`.
 */
export function createAsk(): AskFn {
  const store = new AskStore()

  return <Q extends AskQuestion>(
    ctx: MiddlewareContext,
    question: Q,
  ): AskAnswer<Q> => {
    validateQuestion(question)

    const programId = ctx.session.programId
    const deviceId =
      (question.scope ?? 'device') === 'device' ? ctx.action.device.id : '*'
    const answerKey = `${ctx.session.cursor}::${deviceId}::${question.key}`

    const answer = store.get(programId, answerKey)
    if (answer !== undefined) return answer as AskAnswer<Q>

    throw new PauseSignal(toInteraction(question), {
      kind: 'ask',
      store,
      programId,
      answerKey,
      question,
    } satisfies AskContext)
  }
}

function validateQuestion(question: AskQuestion): void {
  if (question.key.trim() === '') {
    throw new Error('ask(): question key must be a non-empty string')
  }
  switch (question.type) {
    case 'choice': {
      if (question.options.length === 0) {
        throw new Error(
          `ask(): choice question "${question.key}" needs at least one option`,
        )
      }
      const values = new Set(question.options.map(o => o.value))
      if (values.size !== question.options.length) {
        throw new Error(
          `ask(): choice question "${question.key}" has duplicate option values`,
        )
      }
      return
    }
    case 'number_input':
      if (
        question.min !== undefined &&
        question.max !== undefined &&
        question.min > question.max
      ) {
        throw new Error(
          `ask(): number question "${question.key}" has min (${question.min}) > max (${question.max})`,
        )
      }
      return
    case 'text_input':
      return
  }
}

function toInteraction(
  question: AskQuestion,
): TextInputInteraction | NumberInputInteraction | ChoiceInteraction {
  const id = generateId()
  switch (question.type) {
    case 'text_input': {
      const interaction: TextInputInteraction = {
        id,
        type: 'text_input',
        message: question.message,
      }
      if (question.placeholder !== undefined) {
        interaction.placeholder = question.placeholder
      }
      return interaction
    }
    case 'number_input': {
      const interaction: NumberInputInteraction = {
        id,
        type: 'number_input',
        message: question.message,
      }
      if (question.min !== undefined) interaction.min = question.min
      if (question.max !== undefined) interaction.max = question.max
      return interaction
    }
    case 'choice':
      return {
        id,
        type: 'choice',
        message: question.message,
        options: question.options.map(o => ({
          value: o.value,
          label: o.label,
        })),
      }
  }
}
