import type { Session } from '@opennest/sdk'
import { toInteractionPrompt, toToolResult } from './result.js'
import type { ToolResult } from './result.js'
import type { GuardedRuntime, InteractionClient } from './runtime.js'
import type { RespondInput, RunDslInput } from './schemas.js'
import { toSessionSummary } from './session.js'

export interface ToolDeps {
  client: InteractionClient & { getSession(): Session }
  runtime: GuardedRuntime
}

function coreError(error: unknown): ToolResult {
  const message = (error as Error | null | undefined)?.message
  return {
    status: 'failed',
    error: { code: 'core_error', message: String(message ?? error) },
  }
}

export function runDslTool(
  deps: ToolDeps,
  input: RunDslInput,
): Promise<ToolResult> {
  return input.dryRun === true
    ? deps.runtime.check(input.dsl)
    : deps.runtime.runDsl(input.dsl)
}

export function respondTool(
  deps: ToolDeps,
  input: RespondInput,
): Promise<ToolResult> {
  return deps.runtime.respond(input.response)
}

export async function cancelTool(deps: ToolDeps): Promise<ToolResult> {
  try {
    return toToolResult(await deps.client.cancel())
  } catch (error) {
    return coreError(error)
  }
}

export function getSessionTool(deps: ToolDeps): ToolResult {
  try {
    const session = toSessionSummary(deps.client.getSession())
    // Prefer the core's verbatim prompt over the lossy session-context
    // reconstruction (which stays as the fallback when the client has none).
    const pending = deps.client.getPendingInteraction()
    const prompt = pending === null ? null : toInteractionPrompt(pending)
    return {
      status: 'completed',
      session:
        prompt === null ? session : { ...session, pendingInteraction: prompt },
    }
  } catch (error) {
    return coreError(error)
  }
}
