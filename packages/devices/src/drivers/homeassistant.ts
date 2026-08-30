import { createHash } from 'node:crypto'
import type { DeviceDriver, DriverRuntimeContext } from './interface.js'
import {
  interpolateFields,
  normalizeActionConfig,
  normalizePropertyBinding,
  splitService,
} from './ha/binding.js'
import { isRecord, validateDeviceBindings } from './ha/validate.js'
import { HAWebSocketClient, toHaWsUrl } from './ha/ws.js'
import type { HAIncomingMessage } from './ha/ws.js'
import type {
  HAActionStrategy,
  HABinding,
  HAGetStrategy,
  HARawActionConfig,
  HARawPropertyConfig,
  HASetStrategy,
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
  private wsClient: HAWebSocketClient | null = null
  private entityStates = new Map<string, Record<string, unknown>>()
  private stateCache = new Map<
    string,
    { at: number; state: Record<string, unknown> }
  >()
  private cacheProgramId: string | undefined = undefined
  private templateCache = new Map<string, { at: number; value: string }>()
  private templateCacheProgramId: string | undefined = undefined
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
    this.wsClient = new HAWebSocketClient({
      url: toHaWsUrl(this.baseUrl),
      token: this.token,
    })
    this.wsClient.onReady(() => {
      this.entityStates.clear()
      this.subscribeEntityStates()
    })
    this.wsClient.start()
  }

  async close(): Promise<void> {
    const client = this.wsClient
    this.wsClient = null
    await client?.close()
  }

  validateDeviceConfig(
    deviceId: string,
    deviceConfig: Record<string, unknown>,
  ): void {
    validateDeviceBindings(deviceId, deviceConfig)
  }

  async getProperty(
    deviceId: string,
    property: string,
    deviceConfig: Record<string, unknown>,
    runtime?: DriverRuntimeContext,
  ): Promise<unknown> {
    const entry = this.propertyEntry(deviceConfig, property)
    if (!entry) return null

    const get = entry.binding.get
    switch (get.kind) {
      case 'state':
      case 'attribute': {
        const state = await this.resolveState(entry.raw.entity, runtime)
        if (get.kind === 'attribute') {
          const attrs = state['attributes'] as
            Record<string, unknown> | undefined
          return attrs?.[get.attribute] ?? null
        }
        return parseHaState(state['state'])
      }
      case 'template':
        return this.renderTemplate(get.template, runtime)
      case 'script': {
        const result = await this.wsServiceResponse(
          'script',
          'turn_on',
          { entity_id: get.script },
          'script',
          deviceId,
          property,
        )
        return unwrapResponseVariable(result)
      }
      case 'service_response': {
        const [domain, service] = splitService(get.service)
        return this.wsServiceResponse(
          domain,
          service,
          get.fields ?? {},
          'service_response',
          deviceId,
          property,
        )
      }
      default: {
        const unknownKind = (get as HAGetStrategy).kind
        throw new Error(`HA get strategy "${unknownKind}" is not supported`)
      }
    }
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

    let domain: string
    let service: string
    let payload: Record<string, unknown>

    switch (set.kind) {
      case 'inferred': {
        const boolValue = typeof value === 'boolean' ? value : null
        if (boolValue !== null) {
          ;[domain, service] = this.inferBoolService(entity, boolValue)
        } else {
          ;[domain, service] = splitService(`${extractDomain(entity)}.unknown`)
        }
        payload = { entity_id: entity }
        break
      }
      case 'service': {
        ;[domain, service] = splitService(set.service)
        payload = { entity_id: entity }
        if (set.target) {
          Object.assign(payload, set.target)
        }
        if (set.key !== undefined) {
          payload[set.key] = value
        }
        break
      }
      case 'script': {
        // Writes stay on REST (like every set/action path): scripts need no
        // response here, so no websocket coupling is introduced.
        domain = 'script'
        service = 'turn_on'
        payload = {
          entity_id: set.script,
          fields: interpolateFields(set.fields, { value }),
        }
        break
      }
      default: {
        const unknownKind = (set as HASetStrategy).kind
        throw new Error(`HA set strategy "${unknownKind}" is not supported`)
      }
    }

    await this.callService(domain, service, payload)
    this.invalidateEntityState([entity])
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

    let domain: string
    let service: string
    let payload: Record<string, unknown>

    switch (strategy.kind) {
      case 'service': {
        ;[domain, service] = splitService(strategy.service)
        payload = {}
        if (strategy.target) {
          Object.assign(payload, strategy.target)
        }
        if (strategy.data) {
          Object.assign(payload, strategy.data)
        }
        Object.assign(payload, args)
        break
      }
      case 'script': {
        // Writes stay on REST (like every set/action path): scripts need no
        // response here, so no websocket coupling is introduced. Argument
        // names are mapped explicitly through the declared fields.
        domain = 'script'
        service = 'turn_on'
        payload = {
          entity_id: strategy.script,
          fields: interpolateFields(strategy.fields, args),
        }
        break
      }
      default: {
        const unknownKind = (strategy as HAActionStrategy).kind
        throw new Error(`HA action strategy "${unknownKind}" is not supported`)
      }
    }

    await this.callService(domain, service, payload)
    this.invalidateEntityState(
      strategy.kind === 'service' ? targetEntityIds(strategy.target) : [],
    )
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
        normalizePropertyBinding(raw),
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

  private subscribeEntityStates(): void {
    this.wsClient
      ?.subscribe({ type: 'subscribe_entities' }, message =>
        this.handleStateEvent(message),
      )
      .catch((error: Error) => {
        // The store stays empty and reads fall back to REST until the next
        // reconnection re-subscribes; a retry would only matter if HA ever
        // rejected subscribe_entities while keeping the socket up.
        console.warn(`HA subscribe_entities failed: ${error.message}`)
      })
  }

  private handleStateEvent(message: HAIncomingMessage): void {
    const event = message.event
    if (!isRecord(event)) return
    // Real HA subscribe_entities protocol (see processEvent in
    // home-assistant-js-websocket): the initial dump and additions come as
    // `a` (compressed states), changes as `c` (a `+`/`-` delta to merge onto
    // the previous state, not a full state) and removals as `r` (id list).
    if (isRecord(event['a'])) {
      for (const [entityId, compressed] of Object.entries(event['a'])) {
        if (isRecord(compressed)) {
          this.entityStates.set(entityId, decompressState(compressed))
        }
      }
    }
    if (isRecord(event['c'])) {
      for (const [entityId, diff] of Object.entries(event['c'])) {
        const current = this.entityStates.get(entityId)
        if (!current) continue
        applyStateDiff(current, diff)
      }
    }
    if (Array.isArray(event['r'])) {
      for (const entityId of event['r']) {
        if (typeof entityId === 'string') this.entityStates.delete(entityId)
      }
    }
  }

  // Service responses only exist over the websocket (`return_response`), so a
  // down socket fails explicitly instead of falling back to REST like reads.
  private wsServiceResponse(
    domain: string,
    service: string,
    payload: Record<string, unknown>,
    strategy: string,
    deviceId: string,
    property: string,
  ): Promise<unknown> {
    const client = this.wsClient
    if (!client || !client.isReady()) {
      throw new Error(
        `HA get strategy "${strategy}" for device "${deviceId}", property "${property}" requires the HA websocket, which is not connected (service responses have no REST fallback)`,
      )
    }
    return client.callService(domain, service, payload, {
      returnResponse: true,
    })
  }

  // State resolution chain, most to least preferred:
  // 1. live store fed by `subscribe_entities` push events (read only while the
  //    websocket is ready; `unavailable`/`unknown` states are stored as-is)
  // 2. REST fetchState fallback, for a socket that is down or an entity that
  //    is missing from the store
  // 3. per-program TTL cache inside fetchState — last resort before the HA
  //    REST API is hit
  private resolveState(
    entityId: string,
    runtime?: DriverRuntimeContext,
  ): Promise<Record<string, unknown>> {
    if (this.wsClient?.isReady()) {
      const live = this.entityStates.get(entityId)
      if (live) return Promise.resolve(live)
    }
    return this.fetchState(entityId, runtime)
  }

  // The push feed can lag behind HA right after a write, so drop only the
  // entities the call may have touched from the live store. When the scope
  // cannot be determined (action without an entity_id target), fall back to
  // dropping everything to guarantee no stale read.
  private invalidateEntityState(entityIds: string[]): void {
    if (entityIds.length === 0) {
      this.entityStates.clear()
      return
    }
    for (const entityId of entityIds) {
      this.entityStates.delete(entityId)
    }
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

  // Template renders follow the per-program TTL pattern of the state cache
  // (same STATE_CACHE_TTL_MS) keyed by the template hash. Unlike entity
  // states they are not invalidated on writes: a template targets no entity,
  // so the TTL alone bounds staleness.
  private async renderTemplate(
    template: string,
    runtime?: DriverRuntimeContext,
  ): Promise<string> {
    if (runtime?.programId) {
      if (this.templateCacheProgramId !== runtime.programId) {
        this.templateCache = new Map()
        this.templateCacheProgramId = runtime.programId
      }
      this.evictExpiredTemplates()
      const key = templateCacheKey(template)
      const cached = this.templateCache.get(key)
      if (cached !== undefined) {
        return cached.value
      }
      const value = await this.renderTemplateRemote(template)
      this.templateCache.set(key, { at: Date.now(), value })
      return value
    }
    return this.renderTemplateRemote(template)
  }

  private evictExpiredTemplates(): void {
    const now = Date.now()
    for (const [key, entry] of this.templateCache) {
      if (now - entry.at >= STATE_CACHE_TTL_MS) {
        this.templateCache.delete(key)
      }
    }
  }

  private async renderTemplateRemote(template: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/template`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ template }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `HA renderTemplate failed: ${res.status} ${res.statusText} — ${body}`,
      )
    }
    return res.text()
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

function templateCacheKey(template: string): string {
  return createHash('sha256').update(template).digest('hex')
}

// A script called with return_response answers as
// `{ <response_variable>: value }`; the variable name belongs to the script,
// so a single-entry response is unwrapped to its value.
function unwrapResponseVariable(result: unknown): unknown {
  if (!isRecord(result)) return result
  const keys = Object.keys(result)
  if (keys.length === 1) return result[keys[0]!]
  return result
}

function targetEntityIds(
  target: Record<string, unknown> | undefined,
): string[] {
  if (!target) return []
  const value = target['entity_id']
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === 'string')
  }
  return []
}

// Translation of the compressed state keys used by subscribe_entities
// (see processEvent in home-assistant-js-websocket) to REST state object keys.
const COMPRESSED_STATE_KEYS: Record<string, string> = {
  s: 'state',
  a: 'attributes',
  c: 'context',
  lc: 'last_changed',
  lu: 'last_updated',
}

function decompressState(
  compressed: Record<string, unknown>,
): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(compressed)) {
    const target = COMPRESSED_STATE_KEYS[key]
    if (target !== undefined) {
      state[target] = value
    }
  }
  return state
}

// Merges a `+`/`-` change delta onto a previously stored decompressed state.
function applyStateDiff(state: Record<string, unknown>, diff: unknown): void {
  if (!isRecord(diff)) return
  const additions = diff['+']
  if (isRecord(additions)) {
    for (const [key, value] of Object.entries(additions)) {
      const target = COMPRESSED_STATE_KEYS[key]
      if (target === undefined) continue
      if (target === 'attributes') {
        if (!isRecord(value)) continue
        const attributes = state['attributes']
        state['attributes'] = {
          ...(isRecord(attributes) ? attributes : {}),
          ...value,
        }
      } else {
        state[target] = value
      }
    }
  }
  const removals = diff['-']
  if (isRecord(removals)) {
    const attributeKeys = removals['a']
    if (Array.isArray(attributeKeys)) {
      const attributes = state['attributes']
      if (isRecord(attributes)) {
        for (const key of attributeKeys) {
          if (typeof key === 'string') delete attributes[key]
        }
      }
    }
  }
}

function parseHaState(state: unknown): unknown {
  if (typeof state !== 'string') return state
  if (state === 'on') return true
  if (state === 'off') return false
  const num = Number(state)
  if (!Number.isNaN(num) && state.trim() !== '') return num
  return state
}
