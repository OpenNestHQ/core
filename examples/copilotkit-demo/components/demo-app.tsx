'use client'

import { CopilotKit } from '@copilotkit/react-core/v2'
import { ModeProvider } from './mode/mode-context'
import { ThreadProvider } from './thread/thread-context'
import { Header } from './layout/header'
import { Sidebar } from './layout/sidebar'
import { ChatArea } from './chat/chat-area'
import { LlmBanner } from './chat/llm-banner'

export function DemoApp({ llmConfigured }: { llmConfigured: boolean }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <ModeProvider>
        <ThreadProvider>
          <div className="flex h-screen">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              {!llmConfigured && <LlmBanner />}
              <div className="flex min-h-0 flex-1">
                <ChatArea />
                {/* VM actions panel: Task 8 */}
              </div>
            </div>
          </div>
        </ThreadProvider>
      </ModeProvider>
    </CopilotKit>
  )
}
