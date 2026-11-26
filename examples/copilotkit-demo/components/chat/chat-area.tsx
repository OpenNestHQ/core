'use client'

import { useState } from 'react'
import { newId } from '@/lib/shared/id'
import { CopilotChat, useAgent } from '@copilotkit/react-core/v2'
import { useThread } from '../thread/thread-context'
import { useMode } from '../mode/mode-context'
import { VmInterrupts } from '../interrupts/vm-interrupt'
import { useDemoState } from '@/lib/client/use-demo-state'
import { DslInput } from './dsl-input'

export function ChatArea() {
  const { threadId } = useThread()
  const { mode } = useMode()
  const { agent } = useAgent()
  const state = useDemoState()
  const [dslMode, setDslMode] = useState(false)
  const questionOpen = state?.pending != null
  const usingDsl = mode === 'advanced' && dslMode

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-question-open={questionOpen}
      data-dsl-input={usingDsl}
    >
      <VmInterrupts />
      {mode === 'advanced' && (
        <label className="absolute right-4 top-2 z-10 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={dslMode}
            onChange={e => setDslMode(e.target.checked)}
          />
          HomeDSL input (no LLM)
        </label>
      )}
      <div className="min-h-0 flex-1">
        <CopilotChat
          key={threadId}
          threadId={threadId}
          className="h-full"
          // CopilotChat does not show RUN_ERROR in the transcript: add it as
          // a local assistant line so the audience sees what went wrong.
          onError={event => {
            if (!('code' in event)) return // the DOM onError of the wrapper
            const { error } = event
            agent.addMessage({
              id: newId(),
              role: 'assistant',
              content: `⚠️ ${error.message}`,
            })
          }}
          labels={{
            chatInputPlaceholder: questionOpen
              ? 'Answer the question above to continue'
              : 'Message the agent…',
          }}
        />
      </div>
      {usingDsl && <DslInput disabled={questionOpen} />}
    </div>
  )
}
