'use client'

import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useDemoState } from '@/lib/client/use-demo-state'
import { useIsMobile } from '@/lib/client/use-is-mobile'
import { summarizeRun } from '@/lib/shared/run-summary'
import type { RunTone } from '@/lib/shared/run-summary'
import { PanelBody } from './panel-body'

const TONE: Record<RunTone, string> = {
  idle: 'text-muted-foreground',
  running: 'text-info',
  waiting: 'text-warning border-warning/60',
  done: 'text-success',
  partial: 'text-destructive',
}

/** A drag down longer than this closes the sheet. */
const SWIPE_CLOSE_PX = 60

/**
 * Phone only: a status bar that is always there, and a bottom sheet with the
 * Basic panel. The sheet opens only when the user taps the bar.
 */
export function MobileStatus() {
  const isMobile = useIsMobile()
  const state = useDemoState()
  const [open, setOpen] = useState(false)
  const dragStart = useRef<number | null>(null)

  if (!isMobile) return null
  const { label, tone } = summarizeRun(state)

  const swipe = {
    onTouchStart: (e: React.TouchEvent) => {
      dragStart.current = e.touches[0]?.clientY ?? null
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = dragStart.current
      const end = e.changedTouches[0]?.clientY
      dragStart.current = null
      if (start !== null && end !== undefined && end - start > SWIPE_CLOSE_PX)
        setOpen(false)
    },
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {/* Aligned with the chat input. Its container ignores pointer events. */}
      <div className="mb-2 px-3.5">
        <Dialog.Trigger
          className={`pointer-events-auto flex w-full items-center justify-between rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs ${TONE[tone]}`}
        >
          <span>{label}</span>
          <span className="text-muted-foreground">▲</span>
        </Dialog.Trigger>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-card"
        >
          <div {...swipe} className="touch-none px-4 pb-1 pt-2">
            <Dialog.Close
              aria-label="Close"
              className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-muted-foreground/50"
            />
            <Dialog.Title className="text-sm font-semibold">
              What&apos;s happening
            </Dialog.Title>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
            <PanelBody mode="basic" />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
