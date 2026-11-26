'use client'

import { useState } from 'react'
import { CopilotKit } from '@copilotkit/react-core/v2'
import { ModeProvider } from './mode/mode-context'
import { ThreadProvider } from './thread/thread-context'
import { Header } from './layout/header'
import { Sidebar } from './layout/sidebar'
import { ChatArea } from './chat/chat-area'
import { LlmBanner } from './chat/llm-banner'
import { ActionsPanel } from './panel/actions-panel'
import { DevicesDialog } from './panel/devices-dialog'

export function DemoApp({ llmConfigured }: { llmConfigured: boolean }) {
  const [devicesOpen, setDevicesOpen] = useState(false)
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
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
    </CopilotKit>
  )
}
