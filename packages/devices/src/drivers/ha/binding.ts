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
  | {
      kind: 'service'
      service: string
      key?: string
      target?: Record<string, unknown>
    }
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

// Flat configs with `set_service` but no `set_value_key` map to `inferred`:
// booleans are then resolved from the entity domain, so the former `{value}`
// template behavior is only preserved when the template domain matches the
// entity domain (e.g. `lock.{value}` on `lock.porte`). The diverging combos —
// `set_service` called as-is, non-boolean values silently dropped,
// template-domain on/off fallback — are intentionally not reproduced here and
// are tracked for stages 5-6.
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

// Runtime mirror of validate.ts' discriminator: a property entry carrying
// `get`/`set` keys is the strategy format and its nested strategies win; the
// flat `attribute` field still feeds the get fallback (target schema keeps it
// alongside a nested `set`), and missing sides default like the flat format
// (state / inferred). Anything else is the legacy flat format.
export function normalizePropertyBinding(raw: HARawPropertyConfig): HABinding {
  const record = raw as unknown as Record<string, unknown>
  if (!isRecord(record)) {
    throw new Error(
      `Property binding must be an object with "get" or "set" keys, got ${typeof raw}: ${String(raw)}`,
    )
  }
  if (!('get' in record || 'set' in record)) {
    return normalizePropertyConfig(raw)
  }
  const attribute = record['attribute']
  const get =
    (record['get'] as HAGetStrategy | undefined) ??
    (typeof attribute === 'string' && attribute !== ''
      ? { kind: 'attribute', attribute }
      : { kind: 'state' })
  const set = (record['set'] as HASetStrategy | undefined) ?? {
    kind: 'inferred',
  }
  return { get, set }
}

// Runtime mirror of validate.ts' action discriminator: a config carrying
// `kind: 'script'` is the strategy format; anything else is the legacy flat
// service action (an explicit `kind: 'service'` keeps the same path).
export function normalizeActionConfig(
  raw: HARawActionConfig,
): HAActionStrategy {
  const record = raw as unknown as Record<string, unknown>
  if (record['kind'] === 'script') {
    const script = record['script']
    if (typeof script !== 'string' || script === '') {
      throw new Error(
        'Invalid action config: strategy "script" requires a "script" id (expected "script.<name>")',
      )
    }
    return {
      kind: 'script',
      script,
      fields: isRecord(record['fields']) ? record['fields'] : {},
    }
  }
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

// Placeholders are whole declared field values (`"$value"`, `"$minutes"`);
// validate.ts applies the same shape rules to them at load time.
export const PLACEHOLDER_RE = /^\$([A-Za-z_][A-Za-z0-9_-]*)$/

// Replaces `$name` placeholders in declared strategy fields with the provided
// values (set: `{ value }`; action: the named call arguments). A placeholder
// with no provided value is omitted, keeping optional arguments optional.
export function interpolateFields(
  fields: Record<string, unknown> | undefined,
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const rendered = interpolateValue(fields ?? {}, values ?? {})
  return isRecord(rendered) ? rendered : {}
}

function interpolateValue(
  value: unknown,
  values: Record<string, unknown>,
): unknown {
  if (typeof value === 'string') {
    const name = PLACEHOLDER_RE.exec(value)?.[1]
    return name === undefined ? value : values[name]
  }
  if (Array.isArray(value)) {
    return value
      .map(item => interpolateValue(item, values))
      .filter(item => item !== undefined)
  }
  if (isRecord(value)) {
    const rendered: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const replacement = interpolateValue(item, values)
      if (replacement !== undefined) {
        rendered[key] = replacement
      }
    }
    return rendered
  }
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
