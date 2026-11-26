import { fileURLToPath } from 'node:url'
import { firstValueFrom, toArray } from 'rxjs'
import { applyPatch } from 'fast-json-patch'
import type { Operation } from 'fast-json-patch'
import { describe, expect, it, vi } from 'vitest'
import { EventType } from '@ag-ui/client'
import type { BaseEvent, Message, RunAgentInput } from '@ag-ui/client'
import type { DemoState } from '../shared/state'
import type { InterruptMetadata } from '../shared/interrupts'
import { OpenNestAgent } from './agent'
import { HouseStore, createHouse } from './house'
import type { LlmChunk, LlmMessage, LlmPort } from './llm'

const TEST_INVENTORY = fileURLToPath(
  new URL('./__fixtures__/inventory.test.yaml', import.meta.url),
)

function testStore(): HouseStore {
  return new HouseStore({
    createHouse: id => createHouse(id, { inventoryPath: TEST_INVENTORY }),
  })
}

type Turn = LlmChunk[] | (() => never)

/** Scripted model: each call to `turn` plays the next scripted turn. */
function fakeLlm(turns: Turn[]): LlmPort & {
  calls: LlmMessage[][]
} {
  const calls: LlmMessage[][] = []
  return {
    calls,
    async *turn({ messages }) {
      calls.push(messages)
      const turn = turns[calls.length - 1] ?? [
        { type: 'text', delta: 'Done.' } as const,
      ]
      if (typeof turn === 'function') turn()
      for (const chunk of turn as LlmChunk[]) yield chunk
    },
  }
}

const say = (delta: string): LlmChunk[] => [{ type: 'text', delta }]
const call = (dsl: string, id = `tc-${dsl.length}`): LlmChunk[] => [
  { type: 'tool_call', id, dsl },
]

let runCounter = 0
function input(
  threadId: string,
  extra: Partial<RunAgentInput> = {},
): RunAgentInput {
  runCounter += 1
  return {
    threadId,
    runId: `run-${runCounter}`,
    messages: [{ id: 'u1', role: 'user', content: 'do it' } as Message],
    tools: [],
    context: [],
    ...extra,
  }
}

async function collect(
  agent: OpenNestAgent,
  runInput: RunAgentInput,
): Promise<BaseEvent[]> {
  return firstValueFrom(agent.run(runInput).pipe(toArray()))
}

const ofType = <T extends BaseEvent>(events: BaseEvent[], type: EventType) =>
  events.filter(e => e.type === type) as T[]

type Finished = BaseEvent & {
  outcome?: {
    type: string
    interrupts?: {
      id: string
      reason: string
      metadata?: InterruptMetadata
    }[]
  }
}
type RunError = BaseEvent & { code?: string; message: string }

const last = (events: BaseEvent[]) => events[events.length - 1]!

/** Rebuilds the client-side state from the snapshot + deltas. */
function replayState(events: BaseEvent[]): DemoState {
  let state: DemoState | undefined
  for (const event of events) {
    if (event.type === EventType.STATE_SNAPSHOT) {
      state = structuredClone(
        (event as BaseEvent & { snapshot: DemoState }).snapshot,
      )
    } else if (event.type === EventType.STATE_DELTA) {
      state = applyPatch(
        state,
        (event as BaseEvent & { delta: Operation[] }).delta,
        false,
        false,
      ).newDocument
    }
  }
  return state!
}

const device = (state: DemoState, id: string) =>
  state.devices.find(d => d.id === id)!.state

describe('OpenNestAgent', () => {
  it('chat turn runs the DSL and streams state', async () => {
    const llm = fakeLlm([
      call('light[bedroom].power = on'),
      say('The bedroom light is on.'),
    ])
    const agent = new OpenNestAgent({ houses: testStore(), llm })
    const events = await collect(agent, input('chat'))
    const types = events.map(e => e.type)
    expect(types[0]).toBe(EventType.RUN_STARTED)
    expect(types).toContain(EventType.STATE_SNAPSHOT)
    expect(types).toContain(EventType.STATE_DELTA)
    expect(types).toContain(EventType.TOOL_CALL_START)
    expect(types).toContain(EventType.TOOL_CALL_RESULT)
    expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT)
    expect((last(events) as Finished).type).toBe(EventType.RUN_FINISHED)
    expect((last(events) as Finished).outcome?.type).toBe('success')
    const state = replayState(events)
    expect(state.statements.map(s => s.status)).toEqual(['success'])
    expect(device(state, 'light_bedroom')['power']).toBe(true)
    expect(state.suggestions).toHaveLength(1)
    // The second model call saw the tool result.
    expect(llm.calls[1]?.at(-1)).toMatchObject({ role: 'tool' })
  })

  it('pauses on device selection and resumes deterministically', async () => {
    const houses = testStore()
    const llm = fakeLlm([
      call('tv[living_room].power = on', 'tc-tv'),
      say('The TV is on.'),
    ])
    const agent = new OpenNestAgent({ houses, llm })
    const paused = await collect(agent, input('pause'))
    const finished = last(paused) as Finished
    expect(finished.type).toBe(EventType.RUN_FINISHED)
    expect(finished.outcome?.type).toBe('interrupt')
    const interrupt = finished.outcome!.interrupts![0]!
    expect(interrupt.reason).toBe('opennest:device_selection')
    expect(llm.calls).toHaveLength(1)
    expect(replayState(paused).pending?.interruptId).toBe(interrupt.id)

    const resumed = await collect(
      agent,
      input('pause', {
        resume: [
          {
            interruptId: interrupt.id,
            status: 'resolved',
            payload: { deviceId: 'tv_living_room' },
          },
        ],
      }),
    )
    expect((last(resumed) as Finished).outcome?.type).toBe('success')
    const results = ofType<BaseEvent & { toolCallId: string }>(
      resumed,
      EventType.TOOL_CALL_RESULT,
    )
    expect(results.map(r => r.toolCallId)).toEqual(['tc-tv'])
    const state = replayState(resumed)
    expect(state.pending).toBeNull()
    expect(device(state, 'tv_living_room')['power']).toBe(true)
    expect(device(state, 'tv_living_room_2')['power']).toBe(false)
    expect(llm.calls).toHaveLength(2)
  })

  it('rejects a chat message while a question is open', async () => {
    const houses = testStore()
    const llm = fakeLlm([call('tv[living_room].power = on')])
    const agent = new OpenNestAgent({ houses, llm })
    await collect(agent, input('busy'))
    const events = await collect(agent, input('busy'))
    const error = last(events) as RunError
    expect(error.type).toBe(EventType.RUN_ERROR)
    expect(error.code).toBe('interrupt_pending')
    expect(houses.peek('busy')!.client.getPendingInteraction()).not.toBeNull()
  })

  it('rejects a resume for an unknown interrupt', async () => {
    const houses = testStore()
    const agent = new OpenNestAgent({
      houses,
      llm: fakeLlm([call('tv[living_room].power = on')]),
    })
    await collect(agent, input('unknown'))
    const events = await collect(
      agent,
      input('unknown', {
        resume: [
          {
            interruptId: 'nope',
            status: 'resolved',
            payload: { deviceId: 'x' },
          },
        ],
      }),
    )
    expect((last(events) as RunError).code).toBe('unknown_interrupt')
  })

  it('rejects a second resume of the same interrupt', async () => {
    const houses = testStore()
    const agent = new OpenNestAgent({
      houses,
      llm: fakeLlm([call('tv[living_room].power = on')]),
    })
    const paused = await collect(agent, input('twice'))
    const id = (last(paused) as Finished).outcome!.interrupts![0]!.id
    const resume = (): RunAgentInput =>
      input('twice', {
        resume: [
          {
            interruptId: id,
            status: 'resolved',
            payload: { deviceId: 'tv_living_room' },
          },
        ],
      })
    const client = houses.peek('twice')!.client
    const spy = vi.spyOn(client, 'resumePending')
    await collect(agent, resume())
    const second = await collect(agent, resume())
    expect((last(second) as RunError).code).toBe('unknown_interrupt')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('re-asks on an invalid answer', async () => {
    const houses = testStore()
    const agent = new OpenNestAgent({
      houses,
      llm: fakeLlm([call('door[entrance].unlock()')]),
    })
    const paused = await collect(agent, input('pin'))
    const first = (last(paused) as Finished).outcome!.interrupts![0]!
    expect(first.reason).toBe('opennest:text_input')
    const again = await collect(
      agent,
      input('pin', {
        resume: [
          { interruptId: first.id, status: 'resolved', payload: { value: 42 } },
        ],
      }),
    )
    const finished = last(again) as Finished
    expect(finished.outcome?.type).toBe('interrupt')
    const second = finished.outcome!.interrupts![0]!
    expect(second.id).toBe(first.id)
    expect(second.metadata?.error).toBeTypeOf('string')
    expect(replayState(again).pending?.error).toBe(second.metadata?.error)
  })

  it('retries after a parse error and stops after 5 attempts', async () => {
    const llm = fakeLlm(Array.from({ length: 6 }, () => call('not dsl !!')))
    const agent = new OpenNestAgent({ houses: testStore(), llm })
    const events = await collect(agent, input('retry'))
    const results = ofType<BaseEvent & { content: string }>(
      events,
      EventType.TOOL_CALL_RESULT,
    )
    expect(results).toHaveLength(5)
    for (const r of results) expect(r.content).toContain('error')
    expect(llm.calls).toHaveLength(5)
    expect(events.map(e => e.type)).toContain(EventType.TEXT_MESSAGE_CONTENT)
    expect((last(events) as Finished).outcome?.type).toBe('success')
  })

  it('answers a suggestion without calling the LLM', async () => {
    const houses = testStore()
    const llm = fakeLlm([call('light[bedroom].power = on'), say('On.')])
    const agent = new OpenNestAgent({ houses, llm })
    const first = await collect(agent, input('sugg'))
    const suggestion = replayState(first).suggestions[0]!
    const events = await collect(
      agent,
      input('sugg', {
        forwardedProps: {
          answerSuggestion: {
            suggestionId: suggestion.id,
            response: { type: 'choice', value: 'cinema' },
          },
        },
      }),
    )
    expect((last(events) as Finished).outcome?.type).toBe('success')
    expect(llm.calls).toHaveLength(2)
    const state = replayState(events)
    expect(device(state, 'light_bedroom')['brightness']).toBe(20)
    expect(state.program?.origin).toBe('suggestion')
  })

  it('dismisses a suggestion', async () => {
    const houses = testStore()
    const agent = new OpenNestAgent({
      houses,
      llm: fakeLlm([call('light[bedroom].power = on'), say('On.')]),
    })
    const first = await collect(agent, input('dismiss'))
    const suggestion = replayState(first).suggestions[0]!
    const events = await collect(
      agent,
      input('dismiss', {
        forwardedProps: { dismissSuggestion: { suggestionId: suggestion.id } },
      }),
    )
    expect((last(events) as Finished).outcome?.type).toBe('success')
    expect(replayState(events).suggestions).toEqual([])
  })

  it('runs direct DSL without the LLM', async () => {
    const llm = fakeLlm([])
    const agent = new OpenNestAgent({ houses: testStore(), llm })
    const events = await collect(
      agent,
      input('dsl', { forwardedProps: { dsl: 'fan[bedroom].power = on' } }),
    )
    expect((last(events) as Finished).outcome?.type).toBe('success')
    expect(llm.calls).toHaveLength(0)
    const state = replayState(events)
    expect(state.program?.origin).toBe('dsl')
    expect(device(state, 'fan_bedroom')['power']).toBe(true)
  })

  it('reports a missing LLM config', async () => {
    const agent = new OpenNestAgent({ houses: testStore(), llm: null })
    const chat = await collect(agent, input('nollm'))
    expect((last(chat) as RunError).code).toBe('llm_not_configured')
    expect(replayState(chat).llm.configured).toBe(false)
    const dsl = await collect(
      agent,
      input('nollm', { forwardedProps: { dsl: 'fan[bedroom].power = on' } }),
    )
    expect((last(dsl) as Finished).outcome?.type).toBe('success')
  })

  it('keeps the house when the LLM fails', async () => {
    const houses = testStore()
    const llm = fakeLlm([
      call('light[bedroom].power = on'),
      say('On.'),
      () => {
        throw new Error('provider down')
      },
    ])
    const agent = new OpenNestAgent({ houses, llm })
    await collect(agent, input('fail'))
    const house = houses.peek('fail')!
    const events = await collect(agent, input('fail'))
    const error = last(events) as RunError
    expect(error.code).toBe('llm_error')
    expect(error.message).toContain('provider down')
    expect(houses.peek('fail')).toBe(house)
    expect(house.panel?.suggestions).toHaveLength(1)
  })

  it('resume on a forgotten thread is unknown', async () => {
    const agent = new OpenNestAgent({ houses: testStore(), llm: fakeLlm([]) })
    const events = await collect(
      agent,
      input('forgotten', {
        resume: [{ interruptId: 'i1', status: 'resolved', payload: {} }],
      }),
    )
    expect((last(events) as RunError).code).toBe('unknown_interrupt')
  })

  it('clone keeps the dependencies', async () => {
    const llm = fakeLlm([])
    const agent = new OpenNestAgent({ houses: testStore(), llm })
    const copy = agent.clone()
    const events = await collect(
      copy,
      input('clone', { forwardedProps: { dsl: 'fan[bedroom].power = on' } }),
    )
    expect((last(events) as Finished).outcome?.type).toBe('success')
  })
})
