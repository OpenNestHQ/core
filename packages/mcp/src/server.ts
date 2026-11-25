import { McpServer } from '@modelcontextprotocol/server'
import type { Session } from '@opennest/sdk'
import { buildInstructions } from './instructions.js'
import type { ToolResult } from './result.js'
import { createGuardedRuntime } from './runtime.js'
import type { InteractionClient } from './runtime.js'
import {
  answerSuggestionInputSchema,
  emptyInputSchema,
  respondInputSchema,
  runDslInputSchema,
} from './schemas.js'
import {
  answerSuggestionTool,
  cancelTool,
  getSessionTool,
  respondTool,
  runDslTool,
} from './tools.js'

export interface DeviceResourceEntry {
  id: string
  type: string
  room: string
  name: string
  owners?: string[]
  tags?: string[]
  capabilities?: { properties: string[]; actions: string[] }
}

export interface OpenNestServerOptions {
  client: InteractionClient & { getSession(): Session; buildPrompt(): string }
  devices: DeviceResourceEntry[]
  maxFailedResumes?: number
}

// Single-flight queue: OpenNestClient is non-reentrant. A rejected handler
// must not poison the chain, so the next call still runs.
function createQueue() {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => T | Promise<T>): Promise<T> => {
    const next = chain.then(fn)
    chain = next.catch(() => {})
    return next
  }
}

function toMcpResult(result: ToolResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
  }
}

export function createOpenNestServer(
  options: OpenNestServerOptions,
): McpServer {
  const { client, devices, maxFailedResumes } = options
  const reference = client.buildPrompt()
  const deps = {
    client,
    runtime: createGuardedRuntime(client, {
      ...(maxFailedResumes !== undefined ? { maxFailedResumes } : {}),
    }),
  }
  const enqueue = createQueue()

  const server = new McpServer(
    { name: 'opennest', version: '0.1.0' },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: buildInstructions(reference),
    },
  )

  server.registerTool(
    'run_dsl',
    {
      title: 'Run HomeDSL',
      description:
        'Parse, validate and execute a HomeDSL program. Set dryRun to only check it. If the result is `waiting_for_user`, ask the user and answer with `respond`.',
      inputSchema: runDslInputSchema,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    ({ dsl, dryRun }) =>
      enqueue(() =>
        runDslTool(deps, { dsl, ...(dryRun !== undefined ? { dryRun } : {}) }),
      ).then(toMcpResult),
  )
  server.registerTool(
    'respond',
    {
      title: 'Respond to interaction',
      description:
        'Answer the pending user interaction reported by a `waiting_for_user` result. The `type` must match the interaction; no id is needed.',
      inputSchema: respondInputSchema,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    input => enqueue(() => respondTool(deps, input)).then(toMcpResult),
  )
  server.registerTool(
    'answer_suggestion',
    {
      title: 'Answer a suggestion',
      description:
        "Answer an optional follow-up `suggestions[]` entry of a completed result, with the user's own answer. The `type` must match the suggestion.",
      inputSchema: answerSuggestionInputSchema,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    input => enqueue(() => answerSuggestionTool(deps, input)).then(toMcpResult),
  )
  server.registerTool(
    'cancel',
    {
      title: 'Cancel execution',
      description:
        'Cancel the pending program and reset the session. Safe to call when nothing is pending.',
      inputSchema: emptyInputSchema,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    () => enqueue(() => cancelTool(deps)).then(toMcpResult),
  )
  server.registerTool(
    'get_session',
    {
      title: 'Get session',
      description:
        'Read-only summary of the current session: variables, `$it`, pending interaction.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    () => enqueue(() => getSessionTool(deps)).then(toMcpResult),
  )

  server.registerResource(
    'dsl-reference',
    'opennest://dsl-reference',
    { title: 'HomeDSL reference', mimeType: 'text/markdown' },
    async uri => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: reference }],
    }),
  )
  server.registerResource(
    'devices',
    'opennest://devices',
    { title: 'Device inventory', mimeType: 'application/json' },
    async uri => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(devices),
        },
      ],
    }),
  )

  return server
}
