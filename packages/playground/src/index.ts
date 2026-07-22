import { ConfirmationPolicy } from "@opennest/vm";
import type { PlannedAction, ExecutionPolicy } from "@opennest/vm";
import { createPlaygroundDevices } from "./devices.js";
import { startRepl } from "./repl.js";
import { initTelemetry } from "./telemetry.js";

async function main(): Promise<void> {
  process.loadEnvFile();

  const telemetry = initTelemetry();
  const { devices } = await createPlaygroundDevices();

  const confirmThermostat = new ConfirmationPolicy({
    requireConfirmation(action: PlannedAction) {
      return action.device.type === "thermostat"
        && action.kind === "set_property"
        && action.property === "temperature";
    },
  });

  const policies: ExecutionPolicy[] = [confirmThermostat];

  await startRepl(devices, policies, telemetry ?? undefined);
}

main().catch(console.error);
