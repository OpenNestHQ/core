#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { DeviceRegistry } from '@opennest/devices'
import type { Device } from '@opennest/devices'
import { OpenNestClient } from '@opennest/sdk'
import { DEFAULT_MAX_FAILED_RESUMES } from './runtime.js'
import { createOpenNestServer } from './server.js'
import type { DeviceResourceEntry } from './server.js'

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliConfigError'
  }
}

export interface CliConfig {
  yamlPath: string
  maxFailedResumes: number
}

type Env = Record<string, string | undefined>

export function resolveConfig(env: Env): CliConfig {
  const yamlPath = env.OPENNEST_YAML ?? 'opennest.yaml'
  const rawMax = env.OPENNEST_MAX_FAILED_RESUMES
  let maxFailedResumes = DEFAULT_MAX_FAILED_RESUMES
  if (rawMax !== undefined) {
    if (!/^\d+$/.test(rawMax) || Number(rawMax) < 1) {
      throw new CliConfigError(
        `Invalid OPENNEST_MAX_FAILED_RESUMES "${rawMax}": expected an integer >= 1.`,
      )
    }
    maxFailedResumes = Number(rawMax)
  }
  return { yamlPath, maxFailedResumes }
}

function keysOf(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'object' && value !== null) return Object.keys(value)
  return null
}

/** Snapshot registry devices for the `opennest://devices` resource. */
export function toDeviceEntries(devices: Device[]): DeviceResourceEntry[] {
  return devices.map(device => {
    const properties = keysOf(device.driverConfig.properties)
    const actions = keysOf(device.driverConfig.actions)
    return {
      id: device.id,
      type: device.type,
      room: device.room,
      name: device.name,
      ...(device.owners !== undefined ? { owners: device.owners } : {}),
      ...(device.tags !== undefined ? { tags: device.tags } : {}),
      // Omitted unless the driverConfig exposes both lists reliably.
      ...(properties !== null && actions !== null
        ? { capabilities: { properties, actions } }
        : {}),
    }
  })
}

export async function runCli(env: Env): Promise<void> {
  const { yamlPath, maxFailedResumes } = resolveConfig(env)
  if (!existsSync(yamlPath)) {
    throw new CliConfigError(
      `Inventory file not found: ${yamlPath}. Set OPENNEST_YAML to your inventory path (default: ./opennest.yaml).`,
    )
  }

  let registry: DeviceRegistry
  try {
    registry = DeviceRegistry.fromYaml(yamlPath)
  } catch (error) {
    throw new CliConfigError(
      `Failed to load inventory ${yamlPath}: ${(error as Error).message}`,
    )
  }

  const devices = toDeviceEntries(registry.getDevices())
  const client = new OpenNestClient({ devices: registry })
  try {
    await client.whenReady()
  } catch (error) {
    throw new CliConfigError(
      `Failed to initialize devices from ${yamlPath}: ${(error as Error).message}`,
    )
  }

  const server = createOpenNestServer({ client, devices, maxFailedResumes })
  await server.connect(new StdioServerTransport())
}

function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  runCli(process.env).catch((error: unknown) => {
    // stdout is reserved for the MCP protocol: diagnostics go to stderr.
    console.error((error as Error).message ?? String(error))
    process.exit(1)
  })
}
