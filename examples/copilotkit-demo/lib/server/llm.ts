import { createOpenAI } from '@ai-sdk/openai'
import { streamText, tool } from 'ai'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import type { Message } from '@ag-ui/core'

/** A conversation message, as the agent hands it to the model. */
export type LlmMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'assistant'; toolCall: { id: string; dsl: string } }
  | { role: 'tool'; toolCallId: string; content: string }

export type LlmChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; dsl: string }

/** The only thing the agent needs from a model: one streamed turn. */
export interface LlmPort {
  turn(input: {
    system: string
    messages: LlmMessage[]
    signal: AbortSignal
  }): AsyncIterable<LlmChunk>
}

export interface LlmConfig {
  apiKey?: string
  baseURL?: string
  model: string
}

export const TOOL_NAME = 'run_homedsl'
const DEFAULT_MODEL = 'openai/gpt-4o-mini'

/**
 * Same env vars as `examples/playground`: an API key (OpenAI) or a base URL
 * (an OpenAI-compatible provider, possibly keyless). Null when neither is set.
 */
export function getLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig | null {
  const apiKey = env['OPENAI_API_KEY'] || undefined
  const baseURL = env['OPENAI_BASE_URL'] || undefined
  if (!apiKey && !baseURL) return null
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
    model: env['OPENNEST_MODEL'] || DEFAULT_MODEL,
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part =>
        part !== null &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text'
          ? String((part as { text?: unknown }).text ?? '')
          : '',
      )
      .join('')
  }
  return ''
}

function dslOf(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args)
    const dsl = (parsed as { dsl?: unknown } | null)?.dsl
    return typeof dsl === 'string' ? dsl : ''
  } catch {
    return ''
  }
}

/**
 * AG-UI history → model messages. Keeps user/assistant text and
 * `run_homedsl` calls that have a result; drops other roles.
 */
export function toLlmMessages(messages: Message[]): LlmMessage[] {
  const answered = new Set(
    messages.flatMap(m => (m.role === 'tool' ? [m.toolCallId] : [])),
  )
  const out: LlmMessage[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const content = textOf(message.content)
      if (content !== '') out.push({ role: 'user', content })
    } else if (message.role === 'assistant') {
      const content = textOf(message.content)
      if (content !== '') out.push({ role: 'assistant', content })
      for (const call of message.toolCalls ?? []) {
        if (call.function.name !== TOOL_NAME || !answered.has(call.id)) continue
        out.push({
          role: 'assistant',
          toolCall: { id: call.id, dsl: dslOf(call.function.arguments) },
        })
      }
    } else if (message.role === 'tool') {
      out.push({
        role: 'tool',
        toolCallId: message.toolCallId,
        content: textOf(message.content),
      })
    }
  }
  return out
}

function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((m): ModelMessage => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: m.toolCallId,
            toolName: TOOL_NAME,
            output: { type: 'text', value: m.content },
          },
        ],
      }
    }
    if ('toolCall' in m) {
      return {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: m.toolCall.id,
            toolName: TOOL_NAME,
            input: { dsl: m.toolCall.dsl },
          },
        ],
      }
    }
    return { role: m.role, content: m.content }
  })
}

/** `LlmPort` over the AI SDK (OpenAI or OpenAI-compatible). */
export function createAiSdkLlm(config: LlmConfig): LlmPort {
  const parts = config.model.split('/')
  const modelName = parts.length > 1 ? parts.slice(1).join('/') : config.model
  const openai = createOpenAI({
    // @ai-sdk/openai refuses to run without a key; keyless
    // OpenAI-compatible servers ignore this placeholder.
    apiKey: config.apiKey ?? 'no-key',
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  })
  // Chat completions: the most widely supported OpenAI-compatible endpoint.
  const model = openai.chat(modelName)
  const tools = {
    [TOOL_NAME]: tool({
      description:
        'Run a HomeDSL program on the simulated home. Returns the execution result.',
      inputSchema: z.object({
        dsl: z.string().describe('HomeDSL statements, one per line'),
      }),
    }),
  }

  return {
    async *turn({ system, messages, signal }) {
      const result = streamText({
        model,
        system,
        messages: toModelMessages(messages),
        tools,
        abortSignal: signal,
      })
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta' && part.text !== '') {
          yield { type: 'text', delta: part.text }
        } else if (part.type === 'tool-call' && part.toolName === TOOL_NAME) {
          const dsl = (part.input as { dsl?: unknown }).dsl
          yield {
            type: 'tool_call',
            id: part.toolCallId,
            dsl: typeof dsl === 'string' ? dsl : '',
          }
        } else if (part.type === 'error') {
          throw part.error instanceof Error
            ? part.error
            : new Error(String(part.error))
        }
      }
    },
  }
}
