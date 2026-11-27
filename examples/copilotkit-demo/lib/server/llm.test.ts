import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Message } from '@ag-ui/core'
import { createHouse } from './house'
import { getLlmConfig, toLlmMessages } from './llm'
import { buildSystemPrompt } from './prompt'

const TEST_INVENTORY = fileURLToPath(
  new URL('./__fixtures__/inventory.test.yaml', import.meta.url),
)

describe('getLlmConfig', () => {
  it('returns null without key and base url', () => {
    expect(getLlmConfig({})).toBeNull()
  })

  it('accepts a base url alone', () => {
    expect(
      getLlmConfig({ OPENAI_BASE_URL: 'http://localhost:11434/v1' }),
    ).toEqual({
      baseURL: 'http://localhost:11434/v1',
      model: 'openai/gpt-4o-mini',
    })
  })

  it('reads OPENNEST_MODEL', () => {
    expect(
      getLlmConfig({
        OPENAI_API_KEY: 'sk-x',
        OPENNEST_MODEL: 'openai/gpt-4.1',
      }),
    ).toEqual({ apiKey: 'sk-x', model: 'openai/gpt-4.1' })
  })

  it('ignores empty values', () => {
    expect(getLlmConfig({ OPENAI_API_KEY: '', OPENAI_BASE_URL: '' })).toBeNull()
  })
})

describe('toLlmMessages', () => {
  it('keeps user, assistant text and tool messages in order', () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', content: 'turn on the bedroom light' },
      {
        id: 'm2',
        role: 'assistant',
        content: 'On it.',
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: {
              name: 'run_homedsl',
              arguments: JSON.stringify({ dsl: 'light[bedroom].power = on' }),
            },
          },
        ],
      },
      {
        id: 'm3',
        role: 'tool',
        toolCallId: 'tc1',
        content: '{"status":"success"}',
      },
      { id: 'm4', role: 'assistant', content: 'The bedroom light is on.' },
      { id: 'm5', role: 'reasoning', content: 'hidden' } as Message,
      {
        id: 'm6',
        role: 'activity',
        activityType: 'PLAN',
        content: {},
      } as Message,
    ]
    expect(toLlmMessages(messages)).toEqual([
      { role: 'user', content: 'turn on the bedroom light' },
      { role: 'assistant', content: 'On it.' },
      {
        role: 'assistant',
        toolCall: { id: 'tc1', dsl: 'light[bedroom].power = on' },
      },
      { role: 'tool', toolCallId: 'tc1', content: '{"status":"success"}' },
      { role: 'assistant', content: 'The bedroom light is on.' },
    ])
  })

  it('drops a tool call that has no result yet', () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', content: 'hi' },
      {
        id: 'm2',
        role: 'assistant',
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'run_homedsl', arguments: '{"dsl":"x"}' },
          },
        ],
      },
    ]
    expect(toLlmMessages(messages)).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('buildSystemPrompt', () => {
  it('mentions run_homedsl and the inventory rooms', async () => {
    const house = await createHouse('t', { inventoryPath: TEST_INVENTORY })
    const prompt = buildSystemPrompt(house.client)
    expect(prompt).toContain('run_homedsl')
    expect(prompt).toContain('living_room')
    expect(prompt).toContain('entrance')
  })
})
