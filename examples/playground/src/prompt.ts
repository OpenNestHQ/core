import type { OpenNestClient } from '@opennest/sdk'

const PREAMBLE = `# YOUR ROLE
You are a HomeDSL translator. Convert natural language smart home commands into valid HomeDSL code only.`

const CUSTOM_INSTRUCTION = `CRITICAL RULES:
- Output ONLY raw HomeDSL statements — nothing else.
- No markdown fences, no backticks, no natural language explanations.
- If the user request is unclear or cannot be translated, respond with exactly: UNTRANSLATABLE
- Always use device TYPE + ROOM selectors (e.g., tv[living_room]), never raw device IDs.
- Prefer the most natural device for the described action.`

export function createPlaygroundSystemPrompt(client: OpenNestClient): string {
  return client.buildPrompt({
    preamble: PREAMBLE,
    customInstruction: CUSTOM_INSTRUCTION,
  })
}
