import type {
  HAActionStrategy,
  HAGetStrategy,
  HASetStrategy,
} from './binding.js'

type Failer = (detail: string) => never

const GET_KINDS: readonly HAGetStrategy['kind'][] = [
  'state',
  'attribute',
  'template',
  'script',
  'service_response',
]
const SET_KINDS: readonly HASetStrategy['kind'][] = [
  'inferred',
  'service',
  'script',
]
const ACTION_KINDS: readonly HAActionStrategy['kind'][] = ['service', 'script']

const SERVICE_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/
const SCRIPT_ID_RE = /^script\.[a-z0-9_]+$/
const PLACEHOLDER_RE = /^\$([A-Za-z_][A-Za-z0-9_-]*)$/

interface Placeholder {
  name: string
  path: string
}

// Validates the bindings of one device init config at driver load time. Only
// the new strategy format is validated (`get`/`set` on properties, `kind` on
// actions); the old flat format is left untouched for retrocompatibility.
export function validateDeviceBindings(
  deviceId: string,
  config: unknown,
): void {
  if (!isRecord(config)) return
  const properties = config['properties']
  if (isRecord(properties)) {
    for (const [name, raw] of Object.entries(properties)) {
      if (isRecord(raw) && ('get' in raw || 'set' in raw)) {
        validateProperty(deviceId, name, raw)
      }
    }
  }
  const actions = config['actions']
  if (isRecord(actions)) {
    for (const [name, raw] of Object.entries(actions)) {
      if (isRecord(raw) && raw['kind'] !== undefined) {
        validateAction(deviceId, name, raw)
      }
    }
  }
}

function validateProperty(
  deviceId: string,
  name: string,
  raw: Record<string, unknown>,
): void {
  const fail: Failer = detail => {
    throw new Error(
      `Invalid HA binding for device "${deviceId}", property "${name}": ${detail}`,
    )
  }
  const get = raw['get']
  if (get !== undefined) {
    if (!isRecord(get)) fail('get strategy must be an object')
    validateGetStrategy(get, fail)
  }
  const set = raw['set']
  if (set !== undefined) {
    if (!isRecord(set)) fail('set strategy must be an object')
    validateSetStrategy(set, raw, fail)
  }
}

function validateGetStrategy(get: Record<string, unknown>, fail: Failer): void {
  const kind = get['kind']
  if (!isKind(kind, GET_KINDS)) {
    fail(`unknown get kind ${quote(kind)} (expected: ${GET_KINDS.join(', ')})`)
  }
  switch (kind) {
    case 'attribute': {
      const attribute = get['attribute']
      if (typeof attribute !== 'string' || attribute === '') {
        fail('get strategy "attribute" requires a non-empty "attribute"')
      }
      break
    }
    case 'template': {
      const template = get['template']
      if (typeof template !== 'string' || template === '') {
        fail('get strategy "template" requires a non-empty "template"')
      }
      break
    }
    case 'script':
      validateScriptId(get['script'], 'get strategy "script"', fail)
      break
    case 'service_response':
      validateServiceId(get['service'], 'get strategy "service_response"', fail)
      break
  }
}

function validateSetStrategy(
  set: Record<string, unknown>,
  property: Record<string, unknown>,
  fail: Failer,
): void {
  const kind = set['kind']
  if (!isKind(kind, SET_KINDS)) {
    fail(`unknown set kind ${quote(kind)} (expected: ${SET_KINDS.join(', ')})`)
  }
  switch (kind) {
    case 'service':
      validateServiceId(set['service'], 'set strategy "service"', fail)
      break
    case 'script': {
      validateScriptId(set['script'], 'set strategy "script"', fail)
      const fields = set['fields']
      if (fields !== undefined && !isRecord(fields)) {
        fail('set strategy "script" requires "fields" to be an object')
      }
      for (const placeholder of collectPlaceholders(fields, '')) {
        if (placeholder.name !== 'value') {
          fail(
            `set strategy "script" has an orphan placeholder "$${placeholder.name}" at fields.${placeholder.path} (only "$value" is available when setting)`,
          )
        }
      }
      break
    }
    case 'inferred': {
      const type = property['type']
      const nonBoolean =
        type === 'number' ||
        type === 'string' ||
        (type === undefined && Array.isArray(property['values']))
      if (nonBoolean) {
        const declared =
          type === 'number' || type === 'string'
            ? `declared type "${type}"`
            : 'declared string values'
        fail(
          `set strategy "inferred" cannot apply non-boolean values (${declared}): they would resolve to the invalid service "${entityDomain(property['entity'])}.unknown"; declare a "service" or "script" set strategy`,
        )
      }
      break
    }
  }
}

function validateAction(
  deviceId: string,
  name: string,
  raw: Record<string, unknown>,
): void {
  const fail: Failer = detail => {
    throw new Error(
      `Invalid HA binding for device "${deviceId}", action "${name}": ${detail}`,
    )
  }
  const kind = raw['kind']
  if (!isKind(kind, ACTION_KINDS)) {
    fail(
      `unknown action kind ${quote(kind)} (expected: ${ACTION_KINDS.join(', ')})`,
    )
  }
  switch (kind) {
    case 'service':
      validateServiceId(raw['service'], 'action strategy "service"', fail)
      break
    case 'script':
      validateScriptId(raw['script'], 'action strategy "script"', fail)
      validateActionPlaceholders(raw, fail)
      break
  }
}

function validateActionPlaceholders(
  raw: Record<string, unknown>,
  fail: Failer,
): void {
  const fields = raw['fields']
  if (fields !== undefined && !isRecord(fields)) {
    fail('action strategy "script" requires "fields" to be an object')
  }
  const placeholders = collectPlaceholders(fields, '')
  if (placeholders.length === 0) return
  // `parameters` is the action's declared argument contract; without it the
  // accepted argument names are open, so placeholders cannot be cross-checked.
  const parameters = raw['parameters']
  if (!Array.isArray(parameters)) return
  const declared = parameters
    .filter((parameter): parameter is Record<string, unknown> =>
      isRecord(parameter),
    )
    .map(parameter => parameter['name'])
    .filter((name): name is string => typeof name === 'string')
  for (const placeholder of placeholders) {
    if (!declared.includes(placeholder.name)) {
      fail(
        `action strategy "script" has an orphan placeholder "$${placeholder.name}" at fields.${placeholder.path} (declared arguments: ${declared.join(', ') || 'none'})`,
      )
    }
  }
}

function validateScriptId(
  script: unknown,
  context: string,
  fail: Failer,
): void {
  if (script === undefined || script === null || script === '') {
    fail(`${context} requires a "script" id (expected "script.<name>")`)
  }
  if (typeof script !== 'string' || !SCRIPT_ID_RE.test(script)) {
    fail(
      `${context} has an invalid script id ${quote(script)} (expected "script.<name>")`,
    )
  }
}

function validateServiceId(
  service: unknown,
  context: string,
  fail: Failer,
): void {
  if (service === undefined || service === null || service === '') {
    fail(`${context} requires a "service" (expected "domain.service")`)
  }
  if (typeof service !== 'string' || !SERVICE_RE.test(service)) {
    fail(
      `${context} has an invalid service format ${quote(service)} (expected "domain.service")`,
    )
  }
}

function collectPlaceholders(value: unknown, path: string): Placeholder[] {
  if (typeof value === 'string') {
    const name = PLACEHOLDER_RE.exec(value)?.[1]
    return name ? [{ name, path }] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectPlaceholders(item, `${path}[${index}]`),
    )
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      collectPlaceholders(item, path ? `${path}.${key}` : key),
    )
  }
  return []
}

function entityDomain(entity: unknown): string {
  if (typeof entity !== 'string' || entity === '') return '<domain>'
  const dot = entity.indexOf('.')
  return dot === -1 ? entity : entity.slice(0, dot)
}

function isKind<K extends string>(
  kind: unknown,
  kinds: readonly K[],
): kind is K {
  return typeof kind === 'string' && (kinds as readonly string[]).includes(kind)
}

function quote(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
