import { isRecord } from './binding.js'

// Declared value contract of a HA property: the OpenNest-facing `type`, the
// allowed OpenNest `values`, the HA → OpenNest `map` and its explicit set
// counterpart `map_set`.
export interface HAValueContract {
  type?: 'boolean' | 'number' | 'string'
  values?: string[]
  map?: Record<string, unknown>
  map_set?: Record<string, unknown>
}

type DeclaredType = NonNullable<HAValueContract['type']>

// Get-side translation of a raw HA value into the OpenNest value of the
// declared contract: `map` first (HA → OpenNest), then coercion to the
// declared `type` (replacing the parseHaState heuristic for typed
// properties), then the `values` membership check. A value outside the
// declared contract is a violated contract, reported as a clear error instead
// of a silent null.
export function mapGetValue(
  value: unknown,
  contract: HAValueContract,
  prefix: string,
): unknown {
  let out = value
  const map = contract.map
  if (isRecord(map)) {
    const mapped = lookupMap(map, value)
    if (mapped !== undefined) out = mapped
  }
  const type = declaredType(contract.type)
  if (type !== undefined) {
    out = coerceToType(out, type, prefix)
  }
  const values = contract.values
  if (Array.isArray(values) && (map !== undefined || type !== undefined)) {
    if (typeof out !== 'string' || !values.includes(out)) {
      throw new Error(
        `${prefix}: value ${describe(out)} is not one of the declared values ${describeList(values)}`,
      )
    }
  }
  return out
}

// Set-side translation of an OpenNest value into the HA value: an explicit
// `map_set` wins (a value outside it is a violated contract, not a silent
// passthrough); otherwise the inverse of the `map` applies when it resolves
// to exactly one HA key; anything else is written through raw.
export function mapSetValue(
  value: unknown,
  contract: HAValueContract,
  prefix: string,
): unknown {
  const mapSet = contract.map_set
  if (isRecord(mapSet)) {
    const mapped = lookupMap(mapSet, value)
    if (mapped === undefined) {
      throw new Error(
        `${prefix}: value ${describe(value)} is not in the declared set map (map_set keys: ${describeList(Object.keys(mapSet))})`,
      )
    }
    return mapped
  }
  const map = contract.map
  if (isRecord(map)) {
    const matches = Object.keys(map).filter(key => map[key] === value)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      throw new Error(
        `${prefix}: value ${describe(value)} has an ambiguous inverse map (${matches.map(key => `"${key}"`).join(', ')} all map to it); declare an explicit "map_set"`,
      )
    }
  }
  return value
}

// Coerces a raw HA value to the declared OpenNest type. Non-coercible values
// fail with a clear error carrying the caller's context prefix.
export function coerceToType(
  value: unknown,
  type: DeclaredType,
  prefix: string,
): unknown {
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'on' || normalized === 'true') return true
      if (normalized === 'off' || normalized === 'false') return false
    }
  } else if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
        return Number(trimmed)
      }
    }
  } else {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }
  throw new Error(
    `${prefix}: value ${describe(value)} is not coercible to the declared type "${type}"`,
  )
}

// Runtime type guard: YAML can carry any `type` string, unknown ones leave the
// property untyped (legacy heuristic applies).
export function declaredType(type: unknown): DeclaredType | undefined {
  return type === 'boolean' || type === 'number' || type === 'string'
    ? type
    : undefined
}

function lookupMap(
  map: Record<string, unknown>,
  value: unknown,
): unknown | undefined {
  const key = mapKey(value)
  if (key === undefined || !Object.hasOwn(map, key)) return undefined
  return map[key]
}

function mapKey(value: unknown): string | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  return undefined
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

function describeList(values: string[]): string {
  return values.map(value => `"${value}"`).join(', ')
}
