import { OpenNestClient, createConfirmationMiddleware } from '@opennest/sdk'
import type { PlannedAction, Middleware } from '@opennest/sdk'
import { createPlaygroundRegistry } from './devices.js'
import { doorPin, quietVolume, suggestAmbiance } from './middleware.js'
import { startRepl } from './repl.js'
import { initTelemetry } from './telemetry.js'

async function main(): Promise<void> {
  process.loadEnvFile()

  const telemetry = initTelemetry()
  const registry = createPlaygroundRegistry()

  const confirmThermostat = createConfirmationMiddleware({
    requireConfirmation(action: PlannedAction) {
      return (
        action.device.type === 'thermostat' &&
        action.kind === 'set_property' &&
        action.property === 'temperature'
      )
    },
  })

  const middleware: Middleware[] = [
    doorPin,
    quietVolume,
    confirmThermostat,
    suggestAmbiance,
  ]

  const client = new OpenNestClient({
    devices: registry,
    middleware,
    ...(telemetry ? { eventBus: telemetry.eventBus } : {}),
  })

  await startRepl(client, registry.getDevices(), telemetry ?? undefined)
}

main().catch(console.error)
