import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { OpenNestClient, RunResult } from '@opennest/sdk'
import { HouseStore, createHouse } from './house'
import type { House } from './house'

const TEST_INVENTORY = fileURLToPath(
  new URL('./__fixtures__/inventory.test.yaml', import.meta.url),
)

function realStore(): HouseStore {
  return new HouseStore({
    createHouse: threadId =>
      createHouse(threadId, { inventoryPath: TEST_INVENTORY }),
  })
}

function fakeHouse(threadId: string): House {
  return {
    threadId,
    client: {} as OpenNestClient,
    registry: { close: vi.fn(async () => {}) } as unknown as House['registry'],
    devices: [],
    events: {} as House['events'],
    lastUsed: 0,
    panel: null,
    openInterrupt: null,
    tracer: null,
    historyStart: 0,
  }
}

async function readPower(house: House, deviceId: string): Promise<unknown> {
  const device = house.devices.find(d => d.id === deviceId)!
  return device.driver.getProperty(deviceId, 'power', device.driverConfig)
}

/** Answers every pending interaction with its first option until done. */
async function runToEnd(
  client: OpenNestClient,
  dsl: string,
): Promise<RunResult> {
  let result = await client.runDsl(dsl)
  while (result.status === 'awaiting_interaction' && result.interaction) {
    const interaction = result.interaction
    if (interaction.type === 'device_selection') {
      result = await client.resumePending({
        type: 'device_selection',
        deviceId: interaction.devices[0]!.id,
      })
    } else if (interaction.type === 'confirmation') {
      result = await client.resumePending({
        type: 'confirmation',
        confirmed: true,
      })
    } else {
      throw new Error(`unexpected interaction ${interaction.type}`)
    }
  }
  return result
}

describe('HouseStore', () => {
  it('creates one house per thread and reuses it', async () => {
    const store = new HouseStore({ createHouse: async id => fakeHouse(id) })
    const a1 = await store.get('a')
    const a2 = await store.get('a')
    const b = await store.get('b')
    expect(a1).toBe(a2)
    expect(b).not.toBe(a1)
    expect(store.size()).toBe(2)
  })

  it('isolates device state between threads', async () => {
    const store = realStore()
    const a = await store.get('a')
    const b = await store.get('b')
    const before = await readPower(b, 'light_bedroom')
    const result = await runToEnd(a.client, 'light[bedroom].power = on')
    expect(result.status).toBe('success')
    expect(await readPower(a, 'light_bedroom')).toBe(true)
    expect(await readPower(b, 'light_bedroom')).toBe(before)
  })

  it('evicts houses idle longer than ttl', async () => {
    let now = 0
    const store = new HouseStore({
      ttlMs: 1000,
      now: () => now,
      createHouse: async id => fakeHouse(id),
    })
    const a = await store.get('a')
    now = 1001
    await store.get('b')
    expect(store.peek('a')).toBeUndefined()
    expect(a.registry.close).toHaveBeenCalled()
  })

  it('evicts the least recently used house above max', async () => {
    let now = 0
    const store = new HouseStore({
      max: 2,
      now: () => now,
      createHouse: async id => fakeHouse(id),
    })
    await store.get('a')
    now = 1
    await store.get('b')
    now = 2
    await store.get('a')
    now = 3
    await store.get('c')
    expect(store.peek('b')).toBeUndefined()
    expect(store.peek('a')).toBeDefined()
    expect(store.peek('c')).toBeDefined()
  })

  it('recreates a house for a forgotten thread', async () => {
    let now = 0
    const store = new HouseStore({
      ttlMs: 10,
      now: () => now,
      createHouse: async id => fakeHouse(id),
    })
    const first = await store.get('a')
    now = 100
    const second = await store.get('a')
    expect(second).not.toBe(first)
  })
})
