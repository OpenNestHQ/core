'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMode } from '../mode/mode-context'
import type { DisplayMode } from '../mode/mode-context'
import { useThread } from '../thread/thread-context'

const MODES: { value: DisplayMode; label: string }[] = [
  { value: 'basic', label: 'Basic' },
  { value: 'advanced', label: 'Advanced' },
]

/** Phone-only menu: replaces the sidebar. */
function MobileMenu({ onOpenDevices }: { onOpenDevices: () => void }) {
  const { newConversation } = useThread()
  const [open, setOpen] = useState(false)
  const item = 'rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted w-full'
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label="Menu"
        className="-ml-1 px-1 text-lg leading-none text-muted-foreground hover:text-foreground md:hidden"
      >
        ☰
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed left-2 top-2 z-50 w-56 rounded-xl border border-border bg-card p-2">
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <Dialog.Description className="sr-only">
            Conversation and house
          </Dialog.Description>
          <button
            className={item}
            onClick={() => {
              setOpen(false)
              newConversation()
            }}
          >
            + New conversation
          </button>
          <button
            className={`${item} text-muted-foreground`}
            onClick={() => {
              setOpen(false)
              onOpenDevices()
            }}
          >
            ⚙ Devices (14)
          </button>
          <p className="px-3 pt-1 text-xs text-muted-foreground">
            Each conversation has its own simulated house.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Header({ onOpenDevices }: { onOpenDevices: () => void }) {
  const { mode, setMode } = useMode()
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-2">
      <div className="flex items-center gap-3">
        <MobileMenu onOpenDevices={onOpenDevices} />
        <span className="text-sm font-semibold">OpenNest · live demo</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Display mode"
        className="hidden overflow-hidden rounded-full border border-border text-xs md:inline-flex"
      >
        {MODES.map(m => (
          <button
            key={m.value}
            role="radio"
            aria-checked={mode === m.value}
            onClick={() => setMode(m.value)}
            className={
              mode === m.value
                ? 'bg-foreground px-3 py-1 text-background'
                : 'px-3 py-1 text-muted-foreground hover:text-foreground'
            }
          >
            {m.label}
          </button>
        ))}
      </div>
    </header>
  )
}
