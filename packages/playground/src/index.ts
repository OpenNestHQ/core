import { createPlaygroundDevices } from "./devices.js";
import { startRepl } from "./repl.js";

async function main(): Promise<void> {
  process.loadEnvFile();

  const { devices } = await createPlaygroundDevices();
  await startRepl(devices);
}

main().catch(console.error);
