'use client'

import type { PanelStatement } from '@/lib/shared/state'
import { useDemoState } from '@/lib/client/use-demo-state'
import type { DisplayMode } from '../mode/mode-context'
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

/** The panel content, shared by the desktop aside and the mobile sheet. */
export function PanelBody({ mode }: { mode: DisplayMode }) {
  const state = useDemoState()
  const program = state?.program ?? null
  const statements = state?.statements ?? []

  return (
    <>
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
    </>
  )
}
