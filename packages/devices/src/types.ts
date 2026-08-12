export interface DevicePropertyConfig {
  type: 'boolean' | 'number' | 'string'
  [key: string]: unknown
}

export interface DeviceEntry {
  id: string
  type: string
  room: string
  name: string
  driver: string
  properties: Record<string, DevicePropertyConfig>
  actions: string[] | Record<string, unknown>
  owners?: string[]
  tags?: string[]
}

export interface DriverGlobalConfig {
  latency?: number
  [key: string]: unknown
}

export interface InventoryYaml {
  drivers: Record<string, DriverGlobalConfig>
  rooms: string[]
  devices: DeviceEntry[]
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
