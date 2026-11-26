'use client'

import { useEffect, useState } from 'react'
import type { PanelStatement } from '@/lib/shared/state'
import { useDemoState } from '@/lib/client/use-demo-state'
import { useMode } from '../mode/mode-context'
import { StatementCard } from './statement-card'
import { TraceTree } from './trace-tree'

const GROUPS: {
  title: string
  match: (s: PanelStatement) => boolean
}[] = [
  {
    title: 'Done',
    match: s => !['pending', 'running', 'waiting'].includes(s.status),
  },
  {
    title: 'Running',
    match: s => s.status === 'running' || s.status === 'waiting',
  },
  { title: 'Up next', match: s => s.status === 'pending' },
]

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
        className="flex w-9 shrink-0 items-center justify-center border-l border-border text-[11px] text-muted-foreground hover:text-foreground"
        style={{ writingMode: 'vertical-rl' }}
      >
        VM actions{statements.length > 0 && ` · ${done} ✓`}
      </button>
    )
  }

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-card">
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
        {statements.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing yet. Ask the agent to do something in the house.
          </p>
        )}
        {mode === 'advanced' && program !== null && program.dsl !== '' && (
          <pre className="mb-2 overflow-x-auto rounded-md bg-black p-2 font-mono text-[10.5px] text-success">
            {program.dsl
              .split('\n')
              .filter(line => line.trim() !== '')
              .map((line, i) => `${i + 1}  ${line}`)
              .join('\n')}
          </pre>
        )}
        {GROUPS.map(group => {
          const items = statements.filter(group.match)
          if (items.length === 0) return null
          return (
            <section key={group.title}>
              <h4 className="mb-1 mt-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h4>
              {items.map(s => (
                <StatementCard key={s.index} statement={s} mode={mode} />
              ))}
            </section>
          )
        })}
        {mode === 'advanced' && state?.trace != null && (
          <section>
            <h4 className="mb-1 mt-2.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Trace
            </h4>
            <TraceTree node={state.trace} />
          </section>
        )}
      </div>
    </aside>
  )
}
