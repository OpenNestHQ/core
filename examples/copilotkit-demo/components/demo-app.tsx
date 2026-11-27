'use client'

import { useState } from 'react'
// `CopilotKit` from /v2 is the v1 compatibility wrapper: it replaces
// `renderCustomMessages` with its own renderer, which would hide our
// suggestion cards. Use the v2 provider directly.
import { CopilotKitProvider } from '@copilotkit/react-core/v2'
import { ModeProvider } from './mode/mode-context'
import { ThreadProvider } from './thread/thread-context'
import { Header } from './layout/header'
import { Sidebar } from './layout/sidebar'
import { ChatArea } from './chat/chat-area'
import { LlmBanner } from './chat/llm-banner'
import { ActionsPanel } from './panel/actions-panel'
import { DevicesDialog } from './panel/devices-dialog'
import { suggestionRenderer } from './suggestions/suggestion-card'
import { answerTraceRenderer } from './chat/answer-trace'

const customRenderers = [suggestionRenderer]
const activityRenderers = [answerTraceRenderer]

export function DemoApp({ llmConfigured }: { llmConfigured: boolean }) {
  const [devicesOpen, setDevicesOpen] = useState(false)
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      // The dev inspector button covers the Basic | Advanced switch.
      enableInspector={false}
      renderCustomMessages={customRenderers}
      renderActivityMessages={activityRenderers}
    >
      <ModeProvider>
        <ThreadProvider>
          <div className="flex h-screen">
            <Sidebar onOpenDevices={() => setDevicesOpen(true)} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Header />
              {!llmConfigured && <LlmBanner />}
              <div className="flex min-h-0 flex-1">
                <ChatArea />
                <ActionsPanel />
              </div>
            </div>
          </div>
          <DevicesDialog open={devicesOpen} onOpenChange={setDevicesOpen} />
        </ThreadProvider>
      </ModeProvider>
    </CopilotKitProvider>
  )
}
