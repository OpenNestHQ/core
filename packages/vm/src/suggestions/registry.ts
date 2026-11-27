import type { SuggestionApply, SuggestionDefinition } from './types.js'

/** A definition together with the `apply` the VM needs to run a follow-up. */
export interface SuggestionDefinitionInternal extends SuggestionDefinition {
  readonly apply: SuggestionApply
}

const definitions = new Map<string, SuggestionDefinitionInternal>()

export function lookupSuggestion(
  name: string,
): SuggestionDefinitionInternal | undefined {
  return definitions.get(name)
}

export function registerSuggestion(
  definition: SuggestionDefinitionInternal,
): SuggestionDefinitionInternal {
  const existing = definitions.get(definition.name)
  if (existing) {
    if (existing.apply !== definition.apply) {
      throw new Error(
        `defineSuggestion(): "${definition.name}" is already defined with a different apply`,
      )
    }
    return existing
  }
  definitions.set(definition.name, definition)
  return definition
}
