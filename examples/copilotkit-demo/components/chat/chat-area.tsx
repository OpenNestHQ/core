'use client'

import { CopilotChat } from '@copilotkit/react-core/v2'
import { useThread } from '../thread/thread-context'
import { useDemoState } from '@/lib/client/use-demo-state'

export function ChatArea() {
  const { threadId } = useThread()
  const state = useDemoState()
  const questionOpen = state?.pending != null

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-question-open={questionOpen}
    >
      <CopilotChat
        key={threadId}
        threadId={threadId}
        className="h-full"
        labels={{
          chatInputPlaceholder: questionOpen
            ? 'Answer the question above to continue'
            : 'Message the agent…',
        }}
      />
    </div>
  )
}
