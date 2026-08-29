import type { DeviceDriver, DriverRuntimeContext } from './interface.js'
import {
  normalizeActionConfig,
  normalizePropertyConfig,
  splitService,
} from './ha/binding.js'
import type {
  HAActionStrategy,
  HABinding,
  HARawActionConfig,
  HARawPropertyConfig,
} from './ha/binding.js'

const DOMAIN_SERVICES: Record<string, { on: string; off: string }> = {
  switch: { on: 'turn_on', off: 'turn_off' },
  light: { on: 'turn_on', off: 'turn_off' },
  fan: { on: 'turn_on', off: 'turn_off' },
  input_boolean: { on: 'turn_on', off: 'turn_off' },
  automation: { on: 'turn_on', off: 'turn_off' },
  script: { on: 'turn_on', off: 'turn_off' },
  lock: { on: 'lock', off: 'unlock' },
}

export const STATE_CACHE_TTL_MS = 5000

export class HADriver implements DeviceDriver {
  readonly name = 'homeassistant'
  private baseUrl = ''
  private token = ''
  private stateCache = new Map<
    string,
    { at: number; state: Record<string, unknown> }
  >()
  private cacheProgramId: string | undefined = undefined
  private propertyBindings = new WeakMap<
    Record<string, unknown>,
    Map<string, HABinding>
  >()
  private actionStrategies = new WeakMap<
    Record<string, unknown>,
    Map<string, HAActionStrategy>
  >()

  async init(
    globalConfig: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _deviceInitConfigs?: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    const url = globalConfig['url']
    const token = globalConfig['token']
    if (typeof url !== 'string' || !url) {
      throw new Error('homeassistant driver requires a `url` in global config')
    }
    if (typeof token !== 'string' || !token) {
      throw new Error(
        'homeassistant driver requires a `token` in global config',
      )
    }
    this.baseUrl = url.replace(/\/+$/, '')
    this.token = token
  }

  async getProperty(
    _deviceId: string,
    property: string,
    deviceConfig: Record<string, unknown>,
    runtime?: DriverRuntimeContext,
  ): Promise<unknown> {
    const entry = this.propertyEntry(deviceConfig, property)
    if (!entry) return null

    const state = await this.fetchState(entry.raw.entity, runtime)

    const get = entry.binding.get
    if (get.kind === 'attribute') {
      const attrs = state['attributes'] as Record<string, unknown> | undefined
      return attrs?.[get.attribute] ?? null
    }
    if (get.kind === 'state') {
      return parseHaState(state['state'])
    }
    throw new Error(`HA get strategy "${get.kind}" is not supported`)
  }

  async setProperty(
    _deviceId: string,
    property: string,
    value: unknown,
    deviceConfig: Record<string, unknown>,
  ): Promise<void> {
    const entry = this.propertyEntry(deviceConfig, property)
    if (!entry) return

    const entity = entry.raw.entity
    const set = entry.binding.set

    const payload: Record<string, unknown> = {
      entity_id: entity,
    }

    let domain: string
    let service: string

    switch (set.kind) {
      case 'inferred': {
        const boolValue = typeof value === 'boolean' ? value : null
        if (boolValue !== null) {
          ;[domain, service] = this.inferBoolService(entity, boolValue)
        } else {
          ;[domain, service] = splitService(`${extractDomain(entity)}.unknown`)
        }
        break
      }
      case 'service': {
        ;[domain, service] = splitService(set.service)
        if (set.key !== undefined) {
          payload[set.key] = value
        }
        break
      }
      default:
        throw new Error(`HA set strategy "${set.kind}" is not supported`)
    }

    await this.callService(domain, service, payload)
    this.stateCache.clear()
  }

  async executeAction(
    _deviceId: string,
    action: string,
    args: Record<string, unknown>,
    deviceConfig: Record<string, unknown>,
  ): Promise<void> {
    const actions = deviceConfig['actions'] as
      Record<string, HARawActionConfig> | undefined
    const raw = actions?.[action]
    if (!raw) return

    const strategy = this.actionStrategy(deviceConfig, action, raw)

    if (strategy.kind !== 'service') {
      throw new Error(`HA action strategy "${strategy.kind}" is not supported`)
    }

    const [domain, service] = splitService(strategy.service)

    const payload: Record<string, unknown> = {}

    if (strategy.target) {
      Object.assign(payload, strategy.target)
    }
    if (strategy.data) {
      Object.assign(payload, strategy.data)
    }
    Object.assign(payload, args)

    await this.callService(domain, service, payload)
    this.stateCache.clear()
  }

  private propertyEntry(
    deviceConfig: Record<string, unknown>,
    property: string,
  ): { raw: HARawPropertyConfig; binding: HABinding } | undefined {
    const props = deviceConfig['properties'] as
      Record<string, HARawPropertyConfig> | undefined
    const raw = props?.[property]
    if (!raw) return undefined
    return {
      raw,
      binding: this.cached(this.propertyBindings, deviceConfig, property, () =>
        normalizePropertyConfig(raw),
      ),
    }
  }

  private actionStrategy(
    deviceConfig: Record<string, unknown>,
    action: string,
    raw: HARawActionConfig,
  ): HAActionStrategy {
    return this.cached(this.actionStrategies, deviceConfig, action, () =>
      normalizeActionConfig(raw),
    )
  }

  private cached<T>(
    cache: WeakMap<Record<string, unknown>, Map<string, T>>,
    deviceConfig: Record<string, unknown>,
    key: string,
    create: () => T,
  ): T {
    let byKey = cache.get(deviceConfig)
    if (!byKey) cache.set(deviceConfig, (byKey = new Map()))
    let value = byKey.get(key)
    if (!value) byKey.set(key, (value = create()))
    return value
  }

  private async fetchState(
    entityId: string,
    runtime?: DriverRuntimeContext,
  ): Promise<Record<string, unknown>> {
    if (runtime?.programId) {
      if (this.cacheProgramId !== runtime.programId) {
        this.stateCache = new Map()
        this.cacheProgramId = runtime.programId
      }
      this.evictExpired()
      const cached = this.stateCache.get(entityId)
      if (cached !== undefined) {
        return cached.state
      }
      const state = await this.fetchStateRemote(entityId)
      this.stateCache.set(entityId, { at: Date.now(), state })
      return state
    }
    return this.fetchStateRemote(entityId)
  }

  private evictExpired(): void {
    const now = Date.now()
    for (const [entityId, entry] of this.stateCache) {
      if (now - entry.at >= STATE_CACHE_TTL_MS) {
        this.stateCache.delete(entityId)
      }
    }
  }

  private async fetchStateRemote(
    entityId: string,
  ): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/api/states/${entityId}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(
        `HA fetchState failed for "${entityId}": ${res.status} ${res.statusText}`,
      )
    }
    return (await res.json()) as Record<string, unknown>
  }

  private async callService(
    domain: string,
    service: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const url = `${this.baseUrl}/api/services/${domain}/${service}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `HA callService "${domain}.${service}" failed: ${res.status} ${res.statusText} — ${body}`,
      )
    }
  }

  private inferBoolService(entityId: string, value: boolean): [string, string] {
    const domain = extractDomain(entityId)
    const mapping = DOMAIN_SERVICES[domain]
    if (mapping) {
      return [domain, value ? mapping.on : mapping.off]
    }
    return [domain, value ? 'turn_on' : 'turn_off']
  }
}

function extractDomain(entityId: string): string {
  const dot = entityId.indexOf('.')
  return dot === -1 ? entityId : entityId.slice(0, dot)
}

function parseHaState(state: unknown): unknown {
  if (typeof state !== 'string') return state
  if (state === 'on') return true
  if (state === 'off') return false
  const num = Number(state)
  if (!Number.isNaN(num) && state.trim() !== '') return num
  return state
}
