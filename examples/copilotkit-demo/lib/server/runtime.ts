import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from '@copilotkit/runtime/v2'
import { OpenNestAgent } from './agent'
import { houses } from './house'
import { createAiSdkLlm, getLlmConfig } from './llm'

/** The agent id the chat uses when none is named. */
export const AGENT_ID = 'default'

function createHandler() {
  const config = getLlmConfig()
  const runtime = new CopilotRuntime({
    agents: {
      [AGENT_ID]: new OpenNestAgent({
        houses,
        llm: config === null ? null : createAiSdkLlm(config),
      }),
    },
    runner: new InMemoryAgentRunner(),
  })
  return createCopilotRuntimeHandler({ runtime, basePath: '/api/copilotkit' })
}

// Not cached on globalThis: in dev, an edit re-evaluates this module and
// must pick up the new agent code. Houses live in ./house (module state).
export const copilotHandler = createHandler()
