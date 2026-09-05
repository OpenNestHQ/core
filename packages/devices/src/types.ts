export interface DevicePropertyConfig {
  type: 'boolean' | 'number' | 'string'
  description?: string
  range?: [number, number]
  values?: string[]
  map?: Record<string, unknown>
  [key: string]: unknown
}

export interface ActionParameterConfig {
  name: string
  type: 'string' | 'number' | 'power' | 'enum'
  description?: string
  values?: string[]
  range?: [number, number]
  required?: boolean
}

export interface ActionEntryConfig {
  description?: string
  service?: string
  target?: Record<string, unknown>
  data?: Record<string, unknown>
  parameters?: ActionParameterConfig[]
  [key: string]: unknown
}

export interface DeviceEntry {
  id: string
  type: string
  room: string
  name: string
  driver: string
  properties: Record<string, DevicePropertyConfig>
  actions: string[] | Record<string, ActionEntryConfig>
  init?: Record<string, unknown>
  owners?: string[]
  tags?: string[]
}

export interface DriverGlobalConfig {
  latency?: number
  [key: string]: unknown
}

export interface DeviceTypeDefinition {
  description?: string
  properties?: Record<string, DevicePropertyConfig>
  actions?: string[] | Record<string, ActionEntryConfig>
}

export interface OwnerTypeDefinition {
  name?: string
  description?: string
}

export interface TagTypeDefinition {
  description?: string
}

export interface InventoryDefinitions {
  devices?: Record<string, DeviceTypeDefinition>
  owners?: Record<string, OwnerTypeDefinition>
  tags?: Record<string, TagTypeDefinition>
}

export interface InventoryYaml {
  drivers: Record<string, DriverGlobalConfig>
  rooms: string[]
  devices: DeviceEntry[]
  definitions?: InventoryDefinitions
}

export interface Device {
  id: string
  type: string
  room: string
  name: string
  driver: import('./drivers/interface.js').DeviceDriver
  driverConfig: Record<string, unknown>
  owners?: string[]
  tags?: string[]
}
