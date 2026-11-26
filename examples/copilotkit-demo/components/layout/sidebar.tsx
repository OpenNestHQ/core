'use client'

import { useThread } from '../thread/thread-context'

export function Sidebar({ onOpenDevices }: { onOpenDevices?: () => void }) {
  const { newConversation } = useThread()
  return (
    <aside className="flex w-48 shrink-0 flex-col gap-1 bg-black/40 p-3 text-xs">
      <button
        onClick={newConversation}
        className="rounded-md border border-border px-2 py-1.5 text-left hover:bg-muted"
      >
        + New conversation
      </button>
      <p className="px-2 pt-1 text-muted-foreground">
        Each conversation has its own simulated house.
      </p>
      <div className="flex-1" />
      <button
        onClick={onOpenDevices}
        disabled={onOpenDevices === undefined}
        className="rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        ⚙ Devices (14)
      </button>
    </aside>
  )
}
