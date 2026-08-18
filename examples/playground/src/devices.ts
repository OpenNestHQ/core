import { fileURLToPath } from 'node:url'
import { DeviceRegistry } from '@opennest/devices'
import type { Device } from '@opennest/sdk'

let registry: DeviceRegistry | undefined

function getRegistry(): DeviceRegistry {
  registry ??= DeviceRegistry.fromYaml(
    fileURLToPath(new URL('../inventory.yaml', import.meta.url)),
  )
  return registry
}

export function createPlaygroundRegistry(): DeviceRegistry {
  return getRegistry()
}

export function createPlaygroundDevices(): Device[] {
  return getRegistry().getDevices()
}
