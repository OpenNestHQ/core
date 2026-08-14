import { describe, it, expect } from 'vitest'
import { extractPromptDefinitions } from './prompt.js'
import type { InventoryYaml } from './types.js'

function inventory(partial: Partial<InventoryYaml> = {}): InventoryYaml {
  return { drivers: {}, rooms: [], devices: [], ...partial }
}

describe('extractPromptDefinitions', () => {
  it('derives devices and rooms from instances', () => {
    const defs = extractPromptDefinitions(
      inventory({
        rooms: ['salon'],
        devices: [
          {
            id: 'tv1',
            type: 'tv',
            room: 'salon',
            name: 'TV',
            driver: 'mock',
            properties: {
              power: { type: 'boolean' },
              volume: { type: 'number' },
              mode: { type: 'string' },
            },
            actions: ['play'],
          },
        ],
      }),
    )

    expect(defs.devices['tv']).toEqual({
      capabilities: [
        { kind: 'property', name: 'power', type: 'power' },
        { kind: 'property', name: 'volume', type: 'number' },
        { kind: 'property', name: 'mode', type: 'string' },
        { kind: 'action', name: 'play' },
      ],
    })
    expect(defs.rooms).toEqual({ salon: {} })
  })

  it('enriches from definitions (description, range, enum, parameters)', () => {
    const defs = extractPromptDefinitions(
      inventory({
        devices: [
          {
            id: 'tv1',
            type: 'tv',
            room: 'salon',
            name: 'TV',
            driver: 'mock',
            properties: {
              volume: { type: 'number' },
              source: { type: 'string' },
            },
            actions: ['play'],
          },
        ],
        definitions: {
          devices: {
            tv: {
              description: 'Television set',
              properties: {
                volume: { type: 'number', range: [0, 100] },
                source: { type: 'string', values: ['hdmi1', 'tv'] },
              },
              actions: {
                announce: {
                  parameters: [
                    { name: 'message', type: 'string', required: true },
                  ],
                },
              },
            },
          },
        },
      }),
    )

    const tv = defs.devices['tv']!
    expect(tv.description).toBe('Television set')
    expect(tv.capabilities).toContainEqual({
      kind: 'property',
      name: 'volume',
      type: 'number',
      range: [0, 100],
    })
    expect(tv.capabilities).toContainEqual({
      kind: 'property',
      name: 'source',
      type: 'enum',
      values: ['hdmi1', 'tv'],
    })
    expect(tv.capabilities).toContainEqual({
      kind: 'action',
      name: 'announce',
      parameters: [{ name: 'message', type: 'string', required: true }],
    })
  })

  it('merges owners and tags with descriptions', () => {
    const defs = extractPromptDefinitions(
      inventory({
        devices: [
          {
            id: 'tv1',
            type: 'tv',
            room: 'salon',
            name: 'TV',
            driver: 'mock',
            properties: {},
            actions: [],
            owners: ['Alice'],
            tags: ['main'],
          },
        ],
        definitions: {
          owners: { Alice: { name: 'Alice', description: "Alice's devices" } },
          tags: { main: { description: 'Main device' } },
        },
      }),
    )

    expect(defs.owners['Alice']).toEqual({
      name: 'Alice',
      description: "Alice's devices",
    })
    expect(defs.tags['main']).toEqual({ description: 'Main device' })
  })

  it('includes owners/tags declared only in definitions and falls back to key', () => {
    const defs = extractPromptDefinitions(
      inventory({
        definitions: {
          owners: { kids: { description: 'Kids' } },
          tags: { security: {} },
        },
      }),
    )

    expect(defs.owners['kids']).toEqual({ name: 'kids', description: 'Kids' })
    expect(defs.tags['security']).toEqual({})
  })

  it('dedupes capabilities across devices of the same type', () => {
    const defs = extractPromptDefinitions(
      inventory({
        devices: [
          {
            id: 't1',
            type: 'tv',
            room: 'a',
            name: 'T1',
            driver: 'mock',
            properties: { power: { type: 'boolean' } },
            actions: ['play'],
          },
          {
            id: 't2',
            type: 'tv',
            room: 'b',
            name: 'T2',
            driver: 'mock',
            properties: {
              power: { type: 'boolean' },
              volume: { type: 'number' },
            },
            actions: ['play', 'pause'],
          },
        ],
      }),
    )

    const names = defs.devices['tv']!.capabilities.map(c => c.name)
    expect(names).toEqual(['power', 'play', 'volume', 'pause'])
  })
})
