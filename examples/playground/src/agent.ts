import type { OpenNestClient, Program } from '@opennest/sdk'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { createPlaygroundSystemPrompt } from './prompt.js'

const MAX_RETRIES = 5

function getModelId(): string {
  return process.env['OPENNEST_MODEL'] ?? 'openai/gpt-4o-mini'
}

function createModel(modelId: string, apiKey: string, baseURL?: string) {
  const parts = modelId.split('/')
  const modelName = parts.length > 1 ? parts[1]! : modelId

  const openai = createOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
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
  const apiKey = process.env['OPENAI_API_KEY']
  const baseURL = process.env['OPENAI_BASE_URL']

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Create a .env file with OPENAI_API_KEY=your-key',
    )
  }

  const model = createModel(modelId, apiKey, baseURL)

  const messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input },
  ]

  let lastDsl = ''

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { text } = await generateText({
      model,
      allowSystemInMessages: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
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
