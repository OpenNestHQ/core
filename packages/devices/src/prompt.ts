import type {
  ActionCapability,
  Capability,
  DeviceDefinition,
  OwnerDefinition,
  PropertyCapability,
  RoomDefinition,
  TagDefinition,
} from '@opennest/lang-core'
import type {
  ActionEntryConfig,
  DevicePropertyConfig,
  InventoryYaml,
} from './types.js'

export interface PromptDefinitions {
  devices: Record<string, DeviceDefinition>
  rooms: Record<string, RoomDefinition>
  owners: Record<string, OwnerDefinition>
  tags: Record<string, TagDefinition>
}

function propertyCapability(
  name: string,
  config: DevicePropertyConfig,
): PropertyCapability {
  if (config.type === 'boolean')
    return { kind: 'property', name, type: 'power' }
  if (config.type === 'number') {
    return {
      kind: 'property',
      name,
      type: 'number',
      ...(config.range ? { range: config.range } : {}),
    }
  }
  if (config.values && config.values.length > 0) {
    return { kind: 'property', name, type: 'enum', values: config.values }
  }
  return { kind: 'property', name, type: 'string' }
}

function actionCapabilities(
  actions: string[] | Record<string, ActionEntryConfig>,
): ActionCapability[] {
  if (Array.isArray(actions)) {
    return actions.map(name => ({ kind: 'action', name }))
  }
  return Object.entries(actions).map(([name, config]) => ({
    kind: 'action',
    name,
    ...(config.parameters ? { parameters: config.parameters } : {}),
  }))
}

// ponytail: capabilities merged by (kind,name), definitions win; no conflict
// detection and no shape validation of range/values coming from the YAML.
function extractDevices(
  inventory: InventoryYaml,
): Record<string, DeviceDefinition> {
  const types = new Set<string>()
  for (const device of inventory.devices) types.add(device.type)
  for (const type of Object.keys(inventory.definitions?.devices ?? {})) {
    types.add(type)
  }

  const devices: Record<string, DeviceDefinition> = {}
  for (const type of types) {
    const definition = inventory.definitions?.devices?.[type]
    const capabilities = new Map<string, Capability>()

    for (const device of inventory.devices) {
      if (device.type !== type) continue
      for (const [name, config] of Object.entries(device.properties)) {
        capabilities.set(`property:${name}`, propertyCapability(name, config))
      }
      for (const cap of actionCapabilities(device.actions)) {
        capabilities.set(`action:${cap.name}`, cap)
      }
    }

    if (definition?.properties) {
      for (const [name, config] of Object.entries(definition.properties)) {
        capabilities.set(`property:${name}`, propertyCapability(name, config))
      }
    }
    if (definition?.actions) {
      for (const cap of actionCapabilities(definition.actions)) {
        capabilities.set(`action:${cap.name}`, cap)
      }
    }

    devices[type] = {
      ...(definition?.description
        ? { description: definition.description }
        : {}),
      capabilities: [...capabilities.values()],
    }
  }
  return devices
}

function extractRooms(
  inventory: InventoryYaml,
): Record<string, RoomDefinition> {
  const rooms: Record<string, RoomDefinition> = {}
  for (const room of inventory.rooms) rooms[room] = {}
  return rooms
}

function extractOwners(
  inventory: InventoryYaml,
): Record<string, OwnerDefinition> {
  const names = new Set<string>()
  for (const device of inventory.devices) {
    for (const owner of device.owners ?? []) names.add(owner)
  }
  for (const owner of Object.keys(inventory.definitions?.owners ?? {})) {
    names.add(owner)
  }

  const owners: Record<string, OwnerDefinition> = {}
  for (const key of names) {
    const definition = inventory.definitions?.owners?.[key]
    owners[key] = {
      name: definition?.name ?? key,
      ...(definition?.description
        ? { description: definition.description }
        : {}),
    }
  }
  return owners
}

function extractTags(inventory: InventoryYaml): Record<string, TagDefinition> {
  const names = new Set<string>()
  for (const device of inventory.devices) {
    for (const tag of device.tags ?? []) names.add(tag)
  }
  for (const tag of Object.keys(inventory.definitions?.tags ?? {})) {
    names.add(tag)
  }

  const tags: Record<string, TagDefinition> = {}
  for (const key of names) {
    const description = inventory.definitions?.tags?.[key]?.description
    tags[key] = { ...(description ? { description } : {}) }
  }
  return tags
}

export function extractPromptDefinitions(
  inventory: InventoryYaml,
): PromptDefinitions {
  return {
    devices: extractDevices(inventory),
    rooms: extractRooms(inventory),
    owners: extractOwners(inventory),
    tags: extractTags(inventory),
  }
}
