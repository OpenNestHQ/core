import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { PLACEHOLDER_RE } from './binding.js'
import { isRecord, validateDeviceBindings } from './validate.js'

// The binding-format documentation ships runnable examples: a commented
// inventory and the yaml snippets of the package README. Both must satisfy
// the load-time validation, so they cannot drift from the implemented
// semantics.
const PACKAGE_ROOT = new URL('../../../', import.meta.url)
const INVENTORY_URL = new URL('examples/inventory.ha.yaml', PACKAGE_ROOT)
const README_URL = new URL('README.md', PACKAGE_ROOT)

const YAML_FENCE = /^```yaml\n([\s\S]*?)^```$/gm

function loadYaml(url: URL): unknown {
  return yaml.load(readFileSync(url, 'utf-8'))
}

// Whole-field placeholders only: a literal merely containing "$value" does
// not carry the value.
function hasValuePlaceholder(value: unknown): boolean {
  if (typeof value === 'string') {
    return PLACEHOLDER_RE.exec(value)?.[1] === 'value'
  }
  if (Array.isArray(value)) {
    return value.some(hasValuePlaceholder)
  }
  if (isRecord(value)) {
    return Object.values(value).some(hasValuePlaceholder)
  }
  return false
}

function haDeviceEntries(inventory: unknown): Record<string, unknown>[] {
  expect(isRecord(inventory), 'the example inventory must be a mapping').toBe(
    true,
  )
  const devices = (inventory as Record<string, unknown>)['devices']
  expect(
    Array.isArray(devices),
    'the example inventory must list devices',
  ).toBe(true)
  return (devices as unknown[])
    .filter((device): device is Record<string, unknown> => isRecord(device))
    .filter(device => device['driver'] === 'homeassistant')
}

describe('HA binding doc examples', () => {
  it('should pass load-time validation for the example inventory', () => {
    const devices = haDeviceEntries(loadYaml(INVENTORY_URL))
    expect(devices.length).toBeGreaterThan(0)
    for (const device of devices) {
      const config = {
        properties: device['properties'],
        actions: device['actions'],
      }
      expect(
        () => validateDeviceBindings(String(device['id']), config),
        `example inventory device "${String(device['id'])}"`,
      ).not.toThrow()
    }
  })

  it('should cover the documented strategies and contracts in the example inventory', () => {
    const devices = haDeviceEntries(loadYaml(INVENTORY_URL))
    const getKinds = new Set<string>()
    const setKinds = new Set<string>()
    const setFeatures = new Set<string>()
    const actionKinds = new Set<string>()
    const contracts = new Set<string>()
    for (const device of devices) {
      const properties = device['properties']
      if (isRecord(properties)) {
        for (const property of Object.values(properties)) {
          if (!isRecord(property)) continue
          if (isRecord(property['map'])) contracts.add('map')
          if (isRecord(property['map_set'])) contracts.add('map_set')
          if (typeof property['type'] === 'string') contracts.add('type')
          if (Array.isArray(property['values'])) contracts.add('values')
          const get = property['get']
          if (isRecord(get) && typeof get['kind'] === 'string') {
            getKinds.add(get['kind'])
          }
          const set = property['set']
          if (isRecord(set) && typeof set['kind'] === 'string') {
            setKinds.add(set['kind'])
            if (set['kind'] === 'service' && set['key'] !== undefined) {
              setFeatures.add('service key')
            }
            if (set['kind'] === 'script') {
              if (hasValuePlaceholder(set['fields'])) {
                setFeatures.add('$value placeholder')
              }
            }
          }
        }
      }
      const actions = device['actions']
      if (isRecord(actions)) {
        for (const action of Object.values(actions)) {
          if (!isRecord(action)) continue
          if (typeof action['kind'] === 'string')
            actionKinds.add(action['kind'])
          if (Array.isArray(action['parameters'])) contracts.add('parameters')
        }
      }
    }
    expect([...getKinds].sort()).toEqual([
      'attribute',
      'script',
      'service_response',
      'state',
      'template',
    ])
    expect([...setKinds].sort()).toEqual(['inferred', 'script', 'service'])
    expect(setFeatures.has('service key')).toBe(true)
    expect(setFeatures.has('$value placeholder')).toBe(true)
    expect([...actionKinds].sort()).toEqual(['script', 'service'])
    expect([...contracts].sort()).toEqual([
      'map',
      'map_set',
      'parameters',
      'type',
      'values',
    ])
  })

  it('should pass load-time validation for every yaml snippet of the README', () => {
    const readme = readFileSync(README_URL, 'utf-8')
    const snippets = [...readme.matchAll(YAML_FENCE)].flatMap(match => {
      const body = match[1]
      return body === undefined ? [] : [body]
    })
    expect(snippets.length).toBeGreaterThan(0)
    snippets.forEach((snippet, index) => {
      const config: unknown = yaml.load(snippet)
      expect(
        () => validateDeviceBindings(`readme-snippet-${index + 1}`, config),
        `README yaml snippet #${index + 1}`,
      ).not.toThrow()
    })
  })
})
