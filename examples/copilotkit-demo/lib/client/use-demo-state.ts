'use client'

import { useAgent } from '@copilotkit/react-core/v2'
import type { DemoState } from '../shared/state'

/** The server-driven panel state, or null before the thread's first run. */
export function useDemoState(): DemoState | null {
  const { agent } = useAgent()
  const state = agent.state as Partial<DemoState> | undefined
  return state !== undefined && Array.isArray(state.statements)
    ? (state as DemoState)
    : null
}
