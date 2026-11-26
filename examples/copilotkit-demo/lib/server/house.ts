import path from 'node:path'
import { DeviceRegistry } from '@opennest/devices'
import { DefaultVMEventBus, OpenNestClient } from '@opennest/sdk'
import type { Device } from '@opennest/sdk'
import { demoMiddleware } from './demo-middleware'

/** One simulated house: its own devices, VM session and event bus. */
export interface House {
  threadId: string
  client: OpenNestClient
  registry: DeviceRegistry
  devices: Device[]
  /** Passed to the client as `eventBus`; the agent subscribes per run. */
  events: DefaultVMEventBus
  lastUsed: number
}

export interface CreateHouseOptions {
  inventoryPath?: string
}

export async function createHouse(
  threadId: string,
  opts: CreateHouseOptions = {},
): Promise<House> {
  const registry = DeviceRegistry.fromYaml(
    opts.inventoryPath ?? path.join(process.cwd(), 'inventory.yaml'),
  )
  await registry.whenReady()
  const events = new DefaultVMEventBus()
  const client = new OpenNestClient({
    devices: registry,
    middleware: demoMiddleware,
    eventBus: events,
  })
  return {
    threadId,
    client,
    registry,
    devices: registry.getDevices(),
    events,
    lastUsed: 0,
  }
}

export interface HouseStoreOptions {
  ttlMs?: number
  max?: number
  now?: () => number
  createHouse?: (threadId: string) => Promise<House>
}

const DEFAULT_TTL_MS = 30 * 60 * 1000
const DEFAULT_MAX = 50

/** In-memory houses keyed by conversation thread, with TTL + LRU eviction. */
export class HouseStore {
  private readonly houses = new Map<string, House>()
  private readonly pending = new Map<string, Promise<House>>()
  private readonly ttlMs: number
  private readonly max: number
  private readonly now: () => number
  private readonly create: (threadId: string) => Promise<House>

  constructor(opts: HouseStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
    this.max = opts.max ?? DEFAULT_MAX
    this.now = opts.now ?? Date.now
    this.create = opts.createHouse ?? (id => createHouse(id))
  }

  async get(threadId: string): Promise<House> {
    this.evictExpired()
    const existing = this.houses.get(threadId)
    if (existing !== undefined) {
      existing.lastUsed = this.now()
      return existing
    }
    // Two concurrent first runs on a thread must share one house.
    let creating = this.pending.get(threadId)
    if (creating === undefined) {
      creating = this.create(threadId)
      this.pending.set(threadId, creating)
    }
    try {
      const house = await creating
      house.lastUsed = this.now()
      this.houses.set(threadId, house)
      this.evictOverflow(threadId)
      return house
    } finally {
      this.pending.delete(threadId)
    }
  }

  peek(threadId: string): House | undefined {
    return this.houses.get(threadId)
  }

  size(): number {
    return this.houses.size
  }

  private evictExpired(): void {
    const limit = this.now() - this.ttlMs
    for (const [id, house] of this.houses) {
      if (house.lastUsed < limit) this.evict(id, house)
    }
  }

  private evictOverflow(keep: string): void {
    while (this.houses.size > this.max) {
      let oldest: House | undefined
      for (const house of this.houses.values()) {
        if (house.threadId === keep) continue
        if (oldest === undefined || house.lastUsed < oldest.lastUsed) {
          oldest = house
        }
      }
      if (oldest === undefined) return
      this.evict(oldest.threadId, oldest)
    }
  }

  private evict(id: string, house: House): void {
    this.houses.delete(id)
    void house.registry.close().catch(() => {})
  }
}

/**
 * Process-wide store. The CopilotKit runtime clones agents per request, so
 * houses must not live on the agent instance.
 */
export const houses = new HouseStore()
