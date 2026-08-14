import { fileURLToPath } from 'node:url'
import { DeviceRegistry } from '@opennest/devices'
import type { PromptDefinitions } from '@opennest/devices'
import type { Device } from '@opennest/vm'

let registry: DeviceRegistry | undefined

function getRegistry(): DeviceRegistry {
  registry ??= DeviceRegistry.fromYaml(
    fileURLToPath(new URL('../inventory.yaml', import.meta.url)),
  )
  return registry
}

export function createPlaygroundDevices(): Device[] {
  return getRegistry().getDevices()
}

export function createPlaygroundPromptDefinitions(): PromptDefinitions {
  return getRegistry().getPromptDefinitions()
}
