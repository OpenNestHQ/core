import type { CollectionRef, Segment } from '@opennest/lang-core'
import type { Device, Session, ResolutionResult } from './types.js'
import { resolveDevices } from './resolver.js'

export function expandCollection(
  collection: CollectionRef,
  devices: Device[],
  session: Session,
): ResolutionResult {
  const pseudoSegments: Segment[] = [
    {
      identifier: collection.device.deviceType,
      selectors: collection.device.selectors,
    },
  ]

  const result = resolveDevices(pseudoSegments, devices, session)

  if (collection.modifier === '@first' && result.devices.length > 0) {
    return { ...result, devices: [result.devices[0]!], ambiguous: false }
  }

  if (collection.modifier === '@oneof') {
    return result
  }

  return result
}

export function selectFirst(devices: Device[]): Device | null {
  if (devices.length === 0) return null
  return devices[0]!
}

export function selectAll(devices: Device[]): Device[] {
  return devices
}
