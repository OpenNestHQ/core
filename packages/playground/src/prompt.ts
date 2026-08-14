import { OpenNestPrompt } from '@opennest/lang-core'
import { createPlaygroundPromptDefinitions } from './devices.js'

export function createPlaygroundSystemPrompt(): string {
  const defs = createPlaygroundPromptDefinitions()
  return new OpenNestPrompt(
    defs.devices,
    defs.rooms,
    defs.owners,
    defs.tags,
  ).prompt({
    preamble: `# YOUR ROLE
You are a HomeDSL translator. Convert natural language smart home commands into valid HomeDSL code only.`,
    customInstruction: `CRITICAL RULES:
- Output ONLY raw HomeDSL statements — nothing else.
- No markdown fences, no backticks, no natural language explanations.
- If the user request is unclear or cannot be translated, respond with exactly: UNTRANSLATABLE
- Always use device TYPE + ROOM selectors (e.g., tv[living_room]), never raw device IDs.
- Prefer the most natural device for the described action.`,
  })
}
