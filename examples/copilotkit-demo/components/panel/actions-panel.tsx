'use client'

import { useEffect, useState } from 'react'
import { useDemoState } from '@/lib/client/use-demo-state'
import { useMode } from '../mode/mode-context'
import { PanelBody } from './panel-body'

export function ActionsPanel() {
  const state = useDemoState()
  const { mode } = useMode()
  const [open, setOpen] = useState(false)
  const program = state?.program ?? null
  const statements = state?.statements ?? []
  // A new program opens the panel: the audience should see it run.
  const programKey =
    program === null ? null : `${program.origin}:${program.dsl}`
  const [seen, setSeen] = useState<string | null>(null)
  useEffect(() => {
    if (programKey !== null && programKey !== seen) {
      setSeen(programKey)
      setOpen(true)
    }
  }, [programKey, seen])

  const done = statements.filter(s => s.status === 'success').length

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="hidden w-9 shrink-0 md:flex items-center justify-center border-l border-border text-[11px] text-muted-foreground hover:text-foreground"
        style={{ writingMode: 'vertical-rl' }}
      >
        VM actions{statements.length > 0 && ` · ${done} ✓`}
      </button>
    )
  }

  return (
    <aside className="hidden w-[340px] shrink-0 md:flex flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <b>{mode === 'basic' ? "What's happening" : 'VM'}</b>
        <div className="flex items-center gap-2">
          {mode === 'advanced' && program?.programId && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {program.programId}
            </span>
          )}
          <button
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            ⟩ close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <PanelBody mode={mode} />
      </div>
    </aside>
  )
}
