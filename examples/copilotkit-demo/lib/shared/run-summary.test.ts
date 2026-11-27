import { describe, expect, it } from 'vitest'
import type { DemoState, StatementStatus } from './state'
import { summarizeRun } from './run-summary'

function state(statuses: StatementStatus[], withProgram = true): DemoState {
  return {
    program: withProgram
      ? { programId: 'p1', dsl: 'light[bedroom].power = on', origin: 'dsl' }
      : null,
    statements: statuses.map((status, index) => ({
      index,
      kind: 'assignment',
      summary: `Statement ${index + 1}`,
      status,
      devices: [],
      middleware: [],
    })),
    trace: null,
    pending: null,
    suggestions: [],
    devices: [],
    llm: { configured: false },
  }
}

describe('summarizeRun', () => {
  it('reads "No actions yet" for a null state and for no statements', () => {
    const idle = { label: '⚙ No actions yet', tone: 'idle' }
    expect(summarizeRun(null)).toEqual(idle)
    expect(summarizeRun(state([], false))).toEqual(idle)
  })

  it('counts done statements while a run is in progress', () => {
    expect(summarizeRun(state(['success', 'running', 'pending']))).toEqual({
      label: '⏳ 1 of 3 done',
      tone: 'running',
    })
  })

  it('says how many statements wait for the user', () => {
    expect(summarizeRun(state(['success', 'waiting', 'pending']))).toEqual({
      label: '⏳ 1 of 3 done · 1 waiting for you',
      tone: 'waiting',
    })
  })

  it('reads "N actions done" when every statement succeeded', () => {
    expect(summarizeRun(state(['success', 'success', 'success']))).toEqual({
      label: '✓ 3 actions done',
      tone: 'done',
    })
    expect(summarizeRun(state(['success']))).toEqual({
      label: '✓ 1 action done',
      tone: 'done',
    })
  })

  it('reads "done · not done" when some statements failed', () => {
    expect(summarizeRun(state(['success', 'blocked', 'error']))).toEqual({
      label: '1 done · 2 not done',
      tone: 'partial',
    })
  })

  it('reads a cancelled run as not done, not as idle', () => {
    expect(summarizeRun(state(['skipped', 'skipped']))).toEqual({
      label: '0 done · 2 not done',
      tone: 'partial',
    })
  })

  it('counts suggestion follow-up steps like any statement', () => {
    const s = state(['success'])
    s.statements.push({
      index: 1,
      kind: 'assignment',
      summary: 'Follow-up step 1',
      status: 'success',
      devices: [],
      middleware: [],
    })
    expect(summarizeRun(s)).toEqual({ label: '✓ 2 actions done', tone: 'done' })
  })
})
