import type { Session } from '@opennest/sdk'
import { toToolResult } from './result.js'
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
    return {
      status: 'completed',
      session: toSessionSummary(deps.client.getSession()),
    }
  } catch (error) {
    return coreError(error)
  }
}
