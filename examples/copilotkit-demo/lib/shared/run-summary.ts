import type { DemoState } from './state'

export type RunTone = 'idle' | 'running' | 'waiting' | 'done' | 'partial'

export interface RunSummary {
  label: string
  tone: RunTone
}

/** One line about the current program, for the mobile status bar. */
export function summarizeRun(state: DemoState | null): RunSummary {
  const statements = state?.statements ?? []
  if (statements.length === 0) {
    return { label: '⚙ No actions yet', tone: 'idle' }
  }
  const count = (...statuses: string[]) =>
    statements.filter(s => statuses.includes(s.status)).length
  const done = count('success')
  const failed = count('skipped', 'blocked', 'error')
  const waiting = count('waiting')
  const active = count('running', 'pending', 'waiting')
  const total = statements.length

  if (active > 0) {
    const progress = `⏳ ${done} of ${total} done`
    return waiting > 0
      ? { label: `${progress} · ${waiting} waiting for you`, tone: 'waiting' }
      : { label: progress, tone: 'running' }
  }
  if (failed > 0) {
    return { label: `${done} done · ${failed} not done`, tone: 'partial' }
  }
  return {
    label: `✓ ${done} ${done === 1 ? 'action' : 'actions'} done`,
    tone: 'done',
  }
}
