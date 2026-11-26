import { describe, expect, it } from 'vitest'
import { OpenNestClient } from '@opennest/sdk'
import type { Program, RunResult, VMEvent } from '@opennest/sdk'
import type { PanelDevice } from '../shared/state'
import {
  applyRunResult,
  applyVmEvent,
  beginProgram,
  cancelProgram,
  initialState,
  summarizeProgram,
} from './panel-state'

const parser = new OpenNestClient({ devices: [] })
const parse = (dsl: string): Program => parser.parse(dsl)

const devices: PanelDevice[] = [
  {
    id: 'light_living_room_1',
    name: 'Living Room Ceiling Light',
    room: 'living_room',
    type: 'light',
    icon: '💡',
    state: { power: false, brightness: 80 },
  },
]

const at = (kind: VMEvent['kind'], extra: object = {}): VMEvent =>
  ({ kind, timestamp: 1000, ...extra }) as VMEvent

describe('summarizeProgram', () => {
  it('summarizes a batch set through a variable as plain English', () => {
    expect(
      summarizeProgram(
        parse('$l = @all(light[living_room])\n$l.brightness = 30'),
      ),
    ).toEqual([
      'Find all living room lights',
      'Living room lights → brightness 30',
    ])
  })

  it('summarizes a single set', () => {
    expect(
      summarizeProgram(parse('thermostat[living_room].temperature = 20')),
    ).toEqual(['Living room thermostat → temperature 20'])
  })

  it('summarizes a power set', () => {
    expect(summarizeProgram(parse('tv[living_room].power = on'))).toEqual([
      'Turn on the living room TV',
    ])
  })

  it('summarizes an action call', () => {
    expect(summarizeProgram(parse('door[entrance].unlock()'))).toEqual([
      'Unlock the entrance door',
    ])
  })

  it('falls back for other statements and never leaks DSL syntax', () => {
    const summaries = summarizeProgram(
      parse(
        '$tv = @oneof(tv)\n@if $tv.power? == on\n    light.power = off\n@endif\nlight[owner:Alice].power = on',
      ),
    )
    expect(summaries[1]).toBe('Step 2')
    for (const summary of summaries) {
      expect(summary).not.toMatch(/[[\]$@_]/)
    }
  })
})

describe('panel state', () => {
  it('beginProgram lists every statement as pending', () => {
    const start = {
      ...initialState(devices, true),
      pending: {
        interruptId: 'x',
        interaction: { id: 'x', type: 'confirmation' as const, message: 'ok?' },
      },
    }
    const state = beginProgram(
      start,
      parse(
        'tv[living_room].power = on\ndoor[entrance].unlock()\nthermostat[living_room].temperature = 20',
      ),
      'dsl',
      'chat',
    )
    expect(state.statements.map(s => s.status)).toEqual([
      'pending',
      'pending',
      'pending',
    ])
    expect(state.pending).toBeNull()
    expect(state.suggestions).toEqual([])
    expect(state.program).toEqual({ programId: '', dsl: 'dsl', origin: 'chat' })
  })

  it('statement events move a statement through running and success', () => {
    let state = beginProgram(
      initialState(devices, true),
      parse('light[living_room].brightness = 30'),
      'light[living_room].brightness = 30',
      'chat',
    )
    const events: VMEvent[] = [
      at('program:begin'),
      at('statement:begin', { index: 0, statementKind: 'assignment' }),
      // As emitted by the VM: the write is on begin, end only has a status.
      at('action:begin', {
        actionKind: 'set_property',
        deviceId: 'light_living_room_1',
        deviceName: 'Living Room Ceiling Light',
        property: 'brightness',
        value: { kind: 'number', value: 30 },
      }),
      at('action:end', { status: 'success' }),
      { ...at('statement:end', { status: 'success' }), timestamp: 1250 },
    ]
    for (const event of events) state = applyVmEvent(state, event)
    const [statement] = state.statements
    expect(statement?.status).toBe('success')
    expect(statement?.durationMs).toBe(250)
    expect(statement?.devices).toEqual([
      {
        id: 'light_living_room_1',
        name: 'Living Room Ceiling Light',
        icon: '💡',
      },
    ])
    expect(state.devices[0]?.state['brightness']).toBe(30)
  })

  it('does not apply a write that failed', () => {
    let state = beginProgram(
      initialState(devices, true),
      parse('light[living_room].brightness = 30'),
      'x',
      'chat',
    )
    state = applyVmEvent(
      state,
      at('statement:begin', { index: 0, statementKind: 'assignment' }),
    )
    state = applyVmEvent(
      state,
      at('action:begin', {
        actionKind: 'set_property',
        deviceId: 'light_living_room_1',
        deviceName: 'Living Room Ceiling Light',
        property: 'brightness',
        value: { kind: 'number', value: 30 },
      }),
    )
    state = applyVmEvent(state, at('action:end', { status: 'failed' }))
    expect(state.devices[0]?.state['brightness']).toBe(80)
  })

  it('a finished run clears the open question and applies changes', () => {
    const start = {
      ...initialState(devices, true),
      pending: {
        interruptId: 'x',
        interaction: { id: 'x', type: 'confirmation' as const, message: 'ok?' },
      },
    }
    const state = applyRunResult(
      start,
      {
        status: 'success',
        interaction: null,
        errors: [],
        executed: [
          {
            statement: parse('light[living_room].power = on').statements[0]!,
            resolvedDevices: [],
            changes: [
              {
                deviceId: 'light_living_room_1',
                property: 'power',
                oldValue: false,
                newValue: true,
              },
            ],
          },
        ],
      },
      'p1',
    )
    expect(state.pending).toBeNull()
    expect(state.devices[0]?.state['power']).toBe(true)
  })

  it('records middleware decisions on the running statement', () => {
    let state = beginProgram(
      initialState(devices, true),
      parse('thermostat[living_room].temperature = 20'),
      'x',
      'chat',
    )
    state = applyVmEvent(
      state,
      at('statement:begin', { index: 0, statementKind: 'assignment' }),
    )
    state = applyVmEvent(
      state,
      at('middleware:begin', {
        name: 'confirmation',
        actionKind: 'set_property',
        deviceId: 'thermostat_living_room',
      }),
    )
    state = applyVmEvent(
      state,
      at('middleware:end', { status: 'waiting', decision: 'paused' }),
    )
    expect(state.statements[0]?.middleware).toEqual(['confirmation → paused'])
  })

  it('a blocked statement is blocked with the plain middleware reason', () => {
    let state = beginProgram(
      initialState(devices, true),
      parse('door[entrance].unlock()'),
      'x',
      'chat',
    )
    const events: VMEvent[] = [
      at('statement:begin', { index: 0, statementKind: 'action' }),
      at('middleware:begin', {
        name: 'doorPin',
        actionKind: 'invoke_action',
        deviceId: 'door_entrance',
      }),
      at('middleware:end', {
        status: 'success',
        decision: 'blocked',
        reason: 'wrong PIN',
      }),
      at('statement:end', {
        status: 'failed',
        errors: [{ message: 'Blocked by middleware "doorPin": wrong PIN' }],
      }),
    ]
    for (const event of events) state = applyVmEvent(state, event)
    expect(state.statements[0]?.status).toBe('blocked')
    expect(state.statements[0]?.reason).toBe('wrong PIN')
  })

  it('cancelProgram marks unfinished statements skipped', () => {
    let state = beginProgram(
      initialState(devices, true),
      parse('tv[living_room].power = on\ndoor[entrance].unlock()'),
      'x',
      'chat',
    )
    state = applyVmEvent(
      state,
      at('statement:begin', { index: 0, statementKind: 'assignment' }),
    )
    state = applyVmEvent(state, at('statement:end', { status: 'waiting' }))
    state = cancelProgram(state)
    expect(state.statements.map(s => s.status)).toEqual(['skipped', 'skipped'])
    expect(state.pending).toBeNull()
  })

  it('aligns run results from the program start in the session history', () => {
    const state = beginProgram(
      initialState(devices, true),
      parse('light[living_room].power = on'),
      'x',
      'chat',
    )
    const entry = (deviceId: string, matched: number) => ({
      statement: parse('light[living_room].power = on').statements[0]!,
      resolvedDevices: [],
      changes: [],
      filter: { candidates: 2, matched, excluded: [] },
      outcomes: [
        {
          deviceId,
          execution: { status: 'accepted' as const },
          verification: { status: 'confirmed' as const },
        },
      ],
    })
    const result: RunResult = {
      status: 'awaiting_interaction',
      interaction: { id: 'i', type: 'confirmation', message: 'ok?' },
      errors: [],
      // One entry from an earlier program, none yet from this one.
      executed: [entry('light_bedroom', 1)],
    }
    const next = applyRunResult(state, result, 'p2', 1)
    expect(next.statements[0]?.outcomes).toBeUndefined()
    expect(next.statements[0]?.resolution).toBeUndefined()
  })

  it('adds follow-up steps that are not in the program', () => {
    const state = applyVmEvent(
      initialState(devices, true),
      at('statement:begin', { index: 0, statementKind: 'assignment' }),
    )
    expect(state.statements).toHaveLength(1)
    expect(state.statements[0]?.status).toBe('running')
    expect(state.statements[0]?.summary).toBe('Follow-up step 1')
  })

  it('awaiting result marks the running statement waiting', () => {
    let state = beginProgram(
      initialState(devices, true),
      parse('tv[living_room].power = on'),
      'x',
      'chat',
    )
    state = applyVmEvent(
      state,
      at('statement:begin', { index: 0, statementKind: 'assignment' }),
    )
    const result: RunResult = {
      status: 'awaiting_interaction',
      executed: [],
      interaction: { id: 'i1', type: 'confirmation', message: 'ok?' },
      errors: [],
    }
    state = applyRunResult(state, result, 'p1')
    expect(state.statements[0]?.status).toBe('waiting')
    expect(state.program?.programId).toBe('p1')
  })

  it('merges resolution, outcomes and suggestions from the run result', () => {
    let state = beginProgram(
      initialState(devices, true),
      parse('light[living_room].power = on'),
      'x',
      'chat',
    )
    const result: RunResult = {
      status: 'success',
      interaction: null,
      errors: [],
      executed: [
        {
          statement: parse('light[living_room].power = on').statements[0]!,
          resolvedDevices: [],
          changes: [],
          filter: {
            candidates: 3,
            matched: 2,
            excluded: [
              {
                deviceId: 'tv_living_room',
                deviceName: 'Living Room TV',
                reason: 'property_not_supported',
                details: 'tv has no property power',
              },
            ],
          },
          outcomes: [
            {
              deviceId: 'light_living_room_1',
              execution: { status: 'accepted' },
              verification: { status: 'confirmed' },
            },
          ],
        },
      ],
      suggestions: [
        {
          id: 's1',
          question: {
            key: 'ambiance',
            type: 'choice',
            message: 'Which ambiance?',
            options: [{ value: 'cinema', label: 'Cinema' }],
          },
          targets: [],
        },
      ],
    }
    state = applyRunResult(state, result, 'p1')
    expect(state.statements[0]?.resolution).toEqual({
      candidates: 3,
      matched: 2,
      excluded: [{ id: 'tv_living_room', reason: 'property_not_supported' }],
    })
    expect(state.statements[0]?.outcomes).toEqual([
      {
        deviceId: 'light_living_room_1',
        execution: 'accepted',
        verification: 'confirmed',
      },
    ])
    expect(state.suggestions.map(s => s.id)).toEqual(['s1'])
  })
})
