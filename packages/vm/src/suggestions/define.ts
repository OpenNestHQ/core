import type { MiddlewareContext } from '../middleware/types.js'
import { validateQuestion } from '../interactions/ask.js'
import { lookupSuggestion, registerSuggestion } from './registry.js'
import type { SuggestionDefinitionInternal } from './registry.js'
import type {
  JsonValue,
  SuggestionApply,
  SuggestionCandidate,
  SuggestionDefinition,
  SuggestionQuestion,
} from './types.js'

/**
 * Declares a named suggestion: a follow-up question middleware can offer after
 * a successful run, and the `apply` that turns the answer into actions.
 * Defining a name again with the same `apply` returns the same definition;
 * with another `apply` it throws.
 */
export function defineSuggestion(
  name: string,
  options: { apply: SuggestionApply },
): SuggestionDefinition {
  if (name.trim() === '') {
    throw new Error('defineSuggestion(): name must be a non-empty string')
  }
  const existing = lookupSuggestion(name)
  if (existing) {
    return registerSuggestion({ ...existing, apply: options.apply })
  }
  const definition: SuggestionDefinitionInternal = {
    name,
    apply: options.apply,
    suggest: (ctx, question) => suggest(name, ctx, question),
  }
  return registerSuggestion(definition)
}

function suggest(
  name: string,
  ctx: MiddlewareContext,
  input: SuggestionQuestion & { data?: JsonValue },
): void {
  const { data, ...rest } = input
  const question = rest as SuggestionQuestion
  validateQuestion(question)

  const clonedQuestion = structuredClone(question)
  const clonedData = data === undefined ? undefined : structuredClone(data)

  const { session } = ctx
  const candidates = (session._suggestionCandidates ??= [])
  const programId = session.programId
  const cursor = session.cursor

  let candidate: SuggestionCandidate | undefined = candidates.find(
    c =>
      c.programId === programId &&
      c.cursor === cursor &&
      c.name === name &&
      c.question.key === question.key,
  )
  if (!candidate) {
    candidate = {
      programId,
      cursor,
      name,
      question: clonedQuestion,
      ...(clonedData !== undefined ? { data: clonedData } : {}),
      pending: [],
      confirmed: [],
    }
    candidates.push(candidate)
  }

  const deviceId = ctx.action.device.id
  if (!candidate.pending.includes(deviceId)) candidate.pending.push(deviceId)
}
