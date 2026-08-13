import type { DeviceDriver } from './interface.js'

interface HAPropertyConfig {
  entity: string
  attribute?: string
  set_service?: string
  set_value_key?: string
}

interface HAActionConfig {
  service: string
  target?: Record<string, unknown>
  data?: Record<string, unknown>
}

const DOMAIN_SERVICES: Record<string, { on: string; off: string }> = {
  switch: { on: 'turn_on', off: 'turn_off' },
  light: { on: 'turn_on', off: 'turn_off' },
  fan: { on: 'turn_on', off: 'turn_off' },
  input_boolean: { on: 'turn_on', off: 'turn_off' },
  automation: { on: 'turn_on', off: 'turn_off' },
  script: { on: 'turn_on', off: 'turn_off' },
  lock: { on: 'lock', off: 'unlock' },
}

export class HADriver implements DeviceDriver {
  readonly name = 'homeassistant'
  private baseUrl = ''
  private token = ''

  async init(globalConfig: Record<string, unknown>): Promise<void> {
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
  ): Promise<unknown> {
    const props = deviceConfig['properties'] as
      Record<string, HAPropertyConfig> | undefined
    const propConfig = props?.[property]
    if (!propConfig) return null

    const state = await this.fetchState(propConfig.entity)

    if (propConfig.attribute) {
      const attrs = state['attributes'] as Record<string, unknown> | undefined
      return attrs?.[propConfig.attribute] ?? null
    }

    return parseHaState(state['state'])
  }

  async setProperty(
    _deviceId: string,
    property: string,
    value: unknown,
    deviceConfig: Record<string, unknown>,
  ): Promise<void> {
    const props = deviceConfig['properties'] as
      Record<string, HAPropertyConfig> | undefined
    const propConfig = props?.[property]
    if (!propConfig) return

    const boolValue: boolean | null = typeof value === 'boolean' ? value : null

    let domain: string
    let service: string

    if (propConfig.set_service && boolValue !== null) {
      ;[domain, service] = this.resolveBoolService(
        propConfig.set_service,
        boolValue,
      )
    } else if (propConfig.set_service) {
      ;[domain, service] = splitService(propConfig.set_service)
    } else if (boolValue !== null) {
      ;[domain, service] = this.inferBoolService(propConfig.entity, boolValue)
    } else {
      ;[domain, service] = splitService(
        `${extractDomain(propConfig.entity)}.unknown`,
      )
    }

    const payload: Record<string, unknown> = {
      entity_id: propConfig.entity,
    }

    if (propConfig.set_value_key) {
      payload[propConfig.set_value_key] = value
    }

    await this.callService(domain, service, payload)
  }

  async executeAction(
    _deviceId: string,
    action: string,
    args: Record<string, unknown>,
    deviceConfig: Record<string, unknown>,
  ): Promise<void> {
    const actions = deviceConfig['actions'] as
      Record<string, HAActionConfig> | undefined
    const actionConfig = actions?.[action]
    if (!actionConfig) return

    const [domain, service] = splitService(actionConfig.service)

    const payload: Record<string, unknown> = {}

    if (actionConfig.target) {
      Object.assign(payload, actionConfig.target)
    }
    if (actionConfig.data) {
      Object.assign(payload, actionConfig.data)
    }
    Object.assign(payload, args)

    await this.callService(domain, service, payload)
  }

  private async fetchState(entityId: string): Promise<Record<string, unknown>> {
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

  private resolveBoolService(
    serviceTemplate: string,
    value: boolean,
  ): [string, string] {
    const dotIdx = serviceTemplate.indexOf('.')
    const domain = dotIdx === -1 ? '' : serviceTemplate.slice(0, dotIdx)
    const mapping = DOMAIN_SERVICES[domain]
    const boolWord = mapping
      ? value
        ? mapping.on
        : mapping.off
      : value
        ? 'on'
        : 'off'
    const resolved = serviceTemplate.replace(/\{value\}/g, boolWord)
    return splitService(resolved)
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

function splitService(service: string): [string, string] {
  const dot = service.indexOf('.')
  if (dot === -1)
    throw new Error(
      `Invalid service format: "${service}". Expected "domain.service".`,
    )
  return [service.slice(0, dot), service.slice(dot + 1)]
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
