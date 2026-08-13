import { createConfirmationMiddleware } from '@opennest/vm'
import type { PlannedAction, Middleware } from '@opennest/vm'
import { createPlaygroundDevices } from './devices.js'
import { startRepl } from './repl.js'
import { initTelemetry } from './telemetry.js'

async function main(): Promise<void> {
  process.loadEnvFile()

  const telemetry = initTelemetry()
  const devices = createPlaygroundDevices()

  const confirmThermostat = createConfirmationMiddleware({
    requireConfirmation(action: PlannedAction) {
      return (
        action.device.type === 'thermostat' &&
        action.kind === 'set_property' &&
        action.property === 'temperature'
      )
    },
  })

  const middleware: Middleware[] = [confirmThermostat]

  await startRepl(devices, middleware, telemetry ?? undefined)
}

main().catch(console.error)
