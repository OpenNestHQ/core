import { fileURLToPath } from 'node:url'
import { DeviceRegistry } from '@opennest/devices'
import type { Device } from '@opennest/vm'

export function createPlaygroundDevices(): Device[] {
  const path = fileURLToPath(new URL('../inventory.yaml', import.meta.url))
  return DeviceRegistry.fromYaml(path).getDevices()
}
