export interface HARawPropertyConfig {
  entity: string
  attribute?: string
  set_service?: string
  set_value_key?: string
}

export interface HARawActionConfig {
  service: string
  target?: Record<string, unknown>
  data?: Record<string, unknown>
}

export type HAGetStrategy =
  | { kind: 'state' }
  | { kind: 'attribute'; attribute: string }
  | { kind: 'template'; template: string }
  | { kind: 'script'; script: string }
  | {
      kind: 'service_response'
      service: string
      fields?: Record<string, unknown>
    }

export type HASetStrategy =
  | { kind: 'inferred' }
  | { kind: 'service'; service: string; key?: string }
  | { kind: 'script'; script: string; fields: Record<string, unknown> }

export type HAActionStrategy =
  | {
      kind: 'service'
      service: string
      target?: Record<string, unknown>
      data?: Record<string, unknown>
    }
  | { kind: 'script'; script: string; fields: Record<string, unknown> }

export interface HABinding {
  get: HAGetStrategy
  set: HASetStrategy
}

export function normalizePropertyConfig(raw: HARawPropertyConfig): HABinding {
  if (raw.set_service) splitService(raw.set_service)

  const get: HAGetStrategy = raw.attribute
    ? { kind: 'attribute', attribute: raw.attribute }
    : { kind: 'state' }

  const set: HASetStrategy =
    raw.set_service && raw.set_value_key
      ? { kind: 'service', service: raw.set_service, key: raw.set_value_key }
      : { kind: 'inferred' }

  return { get, set }
}

export function normalizeActionConfig(
  raw: HARawActionConfig,
): HAActionStrategy {
  const service: Extract<HAActionStrategy, { kind: 'service' }> = {
    kind: 'service',
    service: raw.service,
  }
  if (raw.target !== undefined) service.target = raw.target
  if (raw.data !== undefined) service.data = raw.data
  return service
}

export function splitService(service: string): [string, string] {
  const dot = service.indexOf('.')
  if (dot === -1)
    throw new Error(
      `Invalid service format: "${service}". Expected "domain.service".`,
    )
  return [service.slice(0, dot), service.slice(dot + 1)]
}
