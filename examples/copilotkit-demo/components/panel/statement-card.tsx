'use client'

import type { PanelStatement, StatementStatus } from '@/lib/shared/state'
import type { DisplayMode } from '../mode/mode-context'

const BASIC_LABEL: Record<StatementStatus, string> = {
  pending: 'Up next',
  running: 'In progress…',
  waiting: 'Waiting for you',
  success: 'Done',
  skipped: 'Skipped',
  blocked: 'Not done',
  error: 'Not done',
}

const BORDER: Record<StatementStatus, string> = {
  pending: 'border-border opacity-60',
  running: 'border-info bg-info/10',
  waiting: 'border-warning bg-warning/10',
  success: 'border-success/70',
  skipped: 'border-border opacity-70',
  blocked: 'border-destructive/70',
  error: 'border-destructive/70',
}

const TEXT: Record<StatementStatus, string> = {
  pending: 'text-muted-foreground',
  running: 'text-info',
  waiting: 'text-warning',
  success: 'text-success',
  skipped: 'text-muted-foreground',
  blocked: 'text-destructive',
  error: 'text-destructive',
}

export function StatementCard({
  statement,
  mode,
}: {
  statement: PanelStatement
  mode: DisplayMode
}) {
  const { status } = statement
  const icon = statement.devices[0]?.icon ?? '•'
  return (
    <div
      className={`mb-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${BORDER[status]}`}
    >
      {mode === 'basic' ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-base leading-none">{icon}</span>
            <b>{statement.summary}</b>
          </div>
          <div className={`mt-0.5 ${TEXT[status]}`}>
            {status === 'success' ? '✓ ' : status === 'waiting' ? '⏳ ' : ''}
            {BASIC_LABEL[status]}
            {statement.devices.length > 1 &&
              ` · ${statement.devices.length} devices`}
            {(status === 'blocked' || status === 'error') &&
              statement.reason !== undefined &&
              ` · ${statement.reason}`}
          </div>
        </>
      ) : (
        <AdvancedBody statement={statement} />
      )}
    </div>
  )
}

function AdvancedBody({ statement }: { statement: PanelStatement }) {
  const { resolution, outcomes } = statement
  return (
    <div className="font-mono text-[10.5px] leading-relaxed">
      <div className="flex justify-between">
        <span>
          #{statement.index + 1} {statement.kind}
        </span>
        <span className={TEXT[statement.status]}>
          {statement.status}
          {statement.durationMs !== undefined && ` · ${statement.durationMs}ms`}
        </span>
      </div>
      {resolution !== undefined && (
        <div>
          resolve: {resolution.candidates} candidates → {resolution.matched}{' '}
          matched
          {resolution.excluded.map(e => (
            <div key={e.id} className="text-muted-foreground">
              excluded {e.id} ({e.reason})
            </div>
          ))}
        </div>
      )}
      {statement.middleware.map((m, i) => (
        <div key={i} className="text-warning">
          middleware: {m}
        </div>
      ))}
      {outcomes !== undefined
        ? outcomes.map(o => (
            <div key={o.deviceId}>
              {o.deviceId} →{' '}
              <span
                className={
                  o.execution === 'accepted'
                    ? 'text-success'
                    : 'text-destructive'
                }
              >
                {o.execution} · {o.verification}
              </span>
            </div>
          ))
        : statement.devices.map(d => <div key={d.id}>{d.id}</div>)}
      {statement.reason !== undefined && (
        <div className="text-destructive">{statement.reason}</div>
      )}
    </div>
  )
}
