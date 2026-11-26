import type { OpenNestClient, Program } from '@opennest/sdk'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type ModelMessage } from 'ai'
import { createPlaygroundSystemPrompt } from './prompt.js'

const MAX_RETRIES = 5

function getModelId(): string {
  return process.env['OPENNEST_MODEL'] ?? 'openai/gpt-4o-mini'
}

export interface NlConfig {
  apiKey?: string
  baseURL?: string
}

/**
 * NL mode needs either an API key (OpenAI) or a base URL (an
 * OpenAI-compatible provider, e.g. a local server that needs no key).
 * Returns null when neither is set.
 */
export function getNlConfig(): NlConfig | null {
  const apiKey = process.env['OPENAI_API_KEY'] || undefined
  const baseURL = process.env['OPENAI_BASE_URL'] || undefined
  if (!apiKey && !baseURL) return null
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
  }
}

function createModel(modelId: string, config: NlConfig) {
  const parts = modelId.split('/')
  const modelName = parts.length > 1 ? parts[1]! : modelId

  const openai = createOpenAI({
    // @ai-sdk/openai refuses to run without a key; keyless
    // OpenAI-compatible servers ignore this placeholder.
    apiKey: config.apiKey ?? 'no-key',
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  })

  return openai(modelName)
}

export interface NlTranslateResult {
  program: Program | null
  dsl: string
  attempts: number
  failed: boolean
}

export type AttemptCallback = (
  attempt: number,
  dsl: string,
  errors: string[] | null,
) => void

export async function translateNlToDsl(
  input: string,
  client: OpenNestClient,
  onAttempt?: AttemptCallback,
): Promise<NlTranslateResult> {
  const systemPrompt = createPlaygroundSystemPrompt(client)
  const modelId = getModelId()
  const config = getNlConfig()

  if (!config) {
    throw new Error(
      'NL mode is not configured. Set OPENAI_API_KEY, or OPENAI_BASE_URL for an OpenAI-compatible provider, in a .env file',
    )
  }

  const model = createModel(modelId, config)

  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input },
  ]

  let lastDsl = ''

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { text } = await generateText({
      model,
      allowSystemInMessages: true,
      messages,
    })

    const dsl = text.trim()
    lastDsl = dsl

    if (dsl === 'UNTRANSLATABLE' || dsl === '') {
      onAttempt?.(attempt + 1, dsl, null)
      return {
        program: null,
        dsl: '',
        attempts: attempt + 1,
        failed: true,
      }
    }

    const feedback = client.analyze(dsl)

    if (
      feedback.parseErrors.length === 0 &&
      feedback.program !== null &&
      feedback.program.statements.length > 0
    ) {
      onAttempt?.(attempt + 1, dsl, null)
      return {
        program: feedback.program,
        dsl,
        attempts: attempt + 1,
        failed: false,
      }
    }

    const errorMessages = feedback.parseErrors.map(e => e.message)
    onAttempt?.(attempt + 1, dsl, errorMessages)

    const errorText = `The HomeDSL you generated has parse errors:\n${errorMessages.join('\n')}\n\nPlease fix the HomeDSL and output ONLY valid code.`

    messages.push({ role: 'assistant', content: dsl })
    messages.push({ role: 'user', content: errorText })
  }

  return {
    program: null,
    dsl: lastDsl,
    attempts: MAX_RETRIES,
    failed: true,
  }
}
