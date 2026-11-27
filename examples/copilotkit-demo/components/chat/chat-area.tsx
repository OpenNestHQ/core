'use client'

import { useState } from 'react'
import { newId } from '@/lib/shared/id'
import {
  CopilotChat,
  CopilotChatInput,
  useAgent,
} from '@copilotkit/react-core/v2'
import type { CopilotChatInputProps } from '@copilotkit/react-core/v2'
import { MobileStatus } from '../panel/mobile-status'
import { useThread } from '../thread/thread-context'
import { useMode } from '../mode/mode-context'
import { VmInterrupts } from '../interrupts/vm-interrupt'
import { useDemoState } from '@/lib/client/use-demo-state'
import { DslInput } from './dsl-input'
import { useIsMobile } from '@/lib/client/use-is-mobile'

/**
 * The chat input, with the phone status bar right above it. The app already
 * follows the visible viewport (`useVisibleViewport`), so the input must not
 * also move itself above the keyboard: that would lift it twice.
 */
function InputWithStatus(props: CopilotChatInputProps) {
  return (
    <>
      <MobileStatus />
      <CopilotChatInput {...props} keyboardHeight={0} />
    </>
  )
}

export function ChatArea() {
  const { threadId } = useThread()
  const { mode } = useMode()
  const isMobile = useIsMobile()
  const { agent } = useAgent()
  const state = useDemoState()
  const [dslMode, setDslMode] = useState(false)
  const questionOpen = state?.pending != null
  // No HomeDSL input on a phone (forced Basic already implies it).
  const usingDsl = !isMobile && mode === 'advanced' && dslMode

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-question-open={questionOpen}
      data-dsl-input={usingDsl}
    >
      <VmInterrupts />
      {!isMobile && mode === 'advanced' && (
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
          input={InputWithStatus}
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
