import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockDriver, DeviceRegistry } from '@opennest/devices'
import { createConfirmationMiddleware, DefaultVMEventBus } from '@opennest/vm'
import { OpenNestClient } from './client.js'
import type { Device, Middleware, UserInteraction } from '@opennest/vm'

interface MakeClientOptions {
  middleware?: Middleware[]
  onInteraction?: (interaction: UserInteraction) => void | Promise<void>
  onInteractionError?: (error: unknown, interaction: UserInteraction) => void
}

async function makeClient(options: MakeClientOptions = {}): Promise<{
  client: OpenNestClient
  driver: MockDriver
}> {
  const driver = new MockDriver()
  await driver.init({})

  const devices: Device[] = [
    {
      id: 'tv_salon',
      type: 'tv',
      room: 'salon',
      name: 'Salon TV',
      driver,
      driverConfig: {},
    },
    {
      id: 'tv_chambre',
      type: 'tv',
      room: 'chambre',
      name: 'Chambre TV',
      driver,
      driverConfig: {},
    },
    {
      id: 'light_salon',
      type: 'light',
      room: 'salon',
      name: 'Salon Light',
      driver,
      driverConfig: {},
    },
  ]

  driver.seed('tv_salon', { power: false, volume: 15 })
  driver.seed('tv_chambre', { power: false, volume: 10 })
  driver.seed('light_salon', { power: false, brightness: 80 })

  return { client: new OpenNestClient({ devices, ...options }), driver }
}

describe('OpenNestClient', () => {
  it('runs a deterministic program to success', async () => {
    const { client, driver } = await makeClient()

    const result = await client.runDsl('tv[salon].power = on')

    expect(result.status).toBe('success')
    expect(result.errors).toHaveLength(0)
    expect(result.executed).toHaveLength(1)
    expect(await driver.getProperty('tv_salon', 'power')).toBe(true)
  })

  it('suspends with awaiting_interaction on ambiguous device', async () => {
    const { client } = await makeClient()

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(result.interaction).not.toBeNull()
    expect(result.interaction!.type).toBe('device_selection')
  })

  it('resumes a pending interaction', async () => {
    const { client, driver } = await makeClient()

    const paused = await client.runDsl('tv.power = on')
    expect(paused.status).toBe('awaiting_interaction')

    const result = await client.resume({
      interactionId: paused.interaction!.id,
      type: 'device_selection',
      deviceId: 'tv_chambre',
    })

    expect(result.status).toBe('success')
    expect(await driver.getProperty('tv_chambre', 'power')).toBe(true)
    expect(await driver.getProperty('tv_salon', 'power')).toBe(false)
  })

  it('round-trips a confirmation interaction', async () => {
    const { client, driver } = await makeClient({
      middleware: [
        createConfirmationMiddleware({ requireConfirmation: () => true }),
      ],
    })

    const paused = await client.runDsl('tv[salon].power = on')
    expect(paused.status).toBe('awaiting_interaction')
    expect(paused.interaction).not.toBeNull()
    expect(paused.interaction!.type).toBe('confirmation')

    const result = await client.resume({
      interactionId: paused.interaction!.id,
      type: 'confirmation',
      confirmed: true,
    })

    expect(result.status).toBe('success')
    expect(await driver.getProperty('tv_salon', 'power')).toBe(true)
  })

  it('invokes onInteraction with the pending interaction', async () => {
    const calls: UserInteraction[] = []
    const { client } = await makeClient({
      onInteraction: interaction => calls.push(interaction),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.id).toBe(result.interaction!.id)
    expect(calls[0]!.type).toBe('device_selection')
  })

  it('resolves run() despite a synchronous onInteraction throw', async () => {
    const errors: unknown[] = []
    const { client } = await makeClient({
      onInteraction: () => {
        throw new Error('sync boom')
      },
      onInteractionError: error => errors.push(error),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })

  it('resolves run() despite a rejected onInteraction promise', async () => {
    const errors: unknown[] = []
    const { client } = await makeClient({
      onInteraction: () => Promise.reject(new Error('async boom')),
      onInteractionError: error => errors.push(error),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    await Promise.resolve()
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
  })

  it('routes onInteractionError with (error, interaction)', async () => {
    const thrown = new Error('routed')
    const received: {
      error: unknown
      interaction: UserInteraction
    }[] = []
    const { client } = await makeClient({
      onInteraction: () => {
        throw thrown
      },
      onInteractionError: (error, interaction) =>
        received.push({ error, interaction }),
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    expect(received).toHaveLength(1)
    expect(received[0]!.error).toBe(thrown)
    expect(received[0]!.interaction).toBe(result.interaction)
  })

  it('does not await a pending onInteraction promise', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const { client } = await makeClient({
      onInteraction: () => gate,
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    release()
  })

  it('ignores onInteraction errors when onInteractionError is missing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { client } = await makeClient({
        onInteraction: () => {
          throw new Error('boom')
        },
      })

      const result = await client.runDsl('tv.power = on')

      expect(result.status).toBe('awaiting_interaction')
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('swallows a throwing onInteractionError on the sync path', async () => {
    const { client } = await makeClient({
      onInteraction: () => {
        throw new Error('sync boom')
      },
      onInteractionError: () => {
        throw new Error('handler boom')
      },
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
  })

  it('swallows a throwing onInteractionError on the async path', async () => {
    const { client } = await makeClient({
      onInteraction: () => Promise.reject(new Error('async boom')),
      onInteractionError: () => {
        throw new Error('handler boom')
      },
    })

    const result = await client.runDsl('tv.power = on')

    expect(result.status).toBe('awaiting_interaction')
    await new Promise(resolve => setTimeout(resolve, 0))
  })

  it('returns an error when no device matches', async () => {
    const { client } = await makeClient()

    const result = await client.runDsl('camera[salon].snapshot()')

    expect(result.status).toBe('error')
    expect(result.errors[0]!.message).toContain(
      "No device of type 'camera' found",
    )
  })

  it('exposes the session through getSession', async () => {
    const { client } = await makeClient()

    const result = await client.runDsl('tv[salon].power = on')

    expect(client.getSession()).toBe(result.session)
    expect(client.getSession().history).toHaveLength(1)
  })

  it('resets the session on cancel', async () => {
    const { client } = await makeClient()

    await client.runDsl('tv[salon].power = on')
    expect(client.getSession().history).toHaveLength(1)

    const result = await client.cancel()

    expect(result.status).toBe('success')
    expect(client.getSession().history).toHaveLength(0)
  })

  it('throws ParseError on invalid DSL', async () => {
    const { client } = await makeClient()

    expect(() => client.parse('??? not valid')).toThrow()
  })

  it('rejects with ParseError when runDsl receives invalid DSL', async () => {
    const { client } = await makeClient()

    await expect(client.runDsl('??? not valid')).rejects.toThrow()
  })

  it('accepts a DeviceRegistry as the devices source', async () => {
    const registry = new DeviceRegistry({
      drivers: { mock: {} },
      rooms: ['salon'],
      devices: [
        {
          id: 'tv_salon',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver: 'mock',
          properties: { power: { type: 'boolean' } },
          actions: [],
        },
      ],
    })

    const client = new OpenNestClient({ devices: registry })
    const result = await client.runDsl('tv[salon].power = on')

    expect(result.status).toBe('success')
    expect(result.executed[0]!.changes[0]!.newValue).toBe(true)
  })
})

const FROM_YAML = `
drivers:
  mock:
    latency: 0
rooms:
  - salon
devices:
  - id: tv_salon
    type: tv
    room: salon
    name: Salon TV
    driver: mock
    properties:
      power:
        type: boolean
    actions: []
`

function writeTempYaml(name: string): string {
  const path = join(
    tmpdir(),
    `opennest-sdk-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.yaml`,
  )
  writeFileSync(path, FROM_YAML, 'utf-8')
  return path
}

describe('OpenNestClient.fromYaml', () => {
  it('builds a client from a YAML inventory file', async () => {
    const path = writeTempYaml('client')
    try {
      const client = await OpenNestClient.fromYaml(path)

      const result = await client.runDsl('tv[salon].power = on')

      expect(result.status).toBe('success')
      expect(result.errors).toHaveLength(0)
      expect(result.executed).toHaveLength(1)
    } finally {
      unlinkSync(path)
    }
  })

  it('forwards middleware and interaction callbacks', async () => {
    const path = writeTempYaml('options')
    try {
      const interactions: UserInteraction[] = []
      const client = await OpenNestClient.fromYaml(path, {
        middleware: [
          createConfirmationMiddleware({ requireConfirmation: () => true }),
        ],
        onInteraction: interaction => interactions.push(interaction),
      })

      const result = await client.runDsl('tv[salon].power = on')

      expect(result.status).toBe('awaiting_interaction')
      expect(result.interaction!.type).toBe('confirmation')
      expect(interactions).toHaveLength(1)
      expect(interactions[0]!.id).toBe(result.interaction!.id)
    } finally {
      unlinkSync(path)
    }
  })

  it('forwards the eventBus through fromYaml', async () => {
    const path = writeTempYaml('event-bus')
    try {
      const events: string[] = []
      const eventBus = new DefaultVMEventBus()
      eventBus.subscribe(event => events.push(event.kind))

      const client = await OpenNestClient.fromYaml(path, { eventBus })

      const result = await client.runDsl('tv[salon].power = on')

      expect(result.status).toBe('success')
      expect(events).toContain('program:begin')
      expect(events).toContain('program:end')
    } finally {
      unlinkSync(path)
    }
  })

  it('forwards promptDefinitions through fromYaml', async () => {
    const path = writeTempYaml('prompt-defs')
    try {
      const registry = new DeviceRegistry(makeInventory())
      const client = await OpenNestClient.fromYaml(path, {
        promptDefinitions: registry.getPromptDefinitions(),
      })

      const prompt = client.buildPrompt()

      expect(prompt).toContain('- tv')
      expect(prompt).toContain('- salon')
    } finally {
      unlinkSync(path)
    }
  })
})

function makeInventory() {
  return {
    drivers: { mock: {} },
    rooms: ['salon'],
    devices: [
      {
        id: 'tv_salon',
        type: 'tv',
        room: 'salon',
        name: 'Salon TV',
        driver: 'mock',
        properties: { power: { type: 'boolean' } },
        actions: [],
      },
    ],
  } as const
}

describe('OpenNestClient.buildPrompt', () => {
  it('generates a prompt from the registry inventory', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({ devices: registry })

    const prompt = client.buildPrompt()

    expect(prompt).toContain('SUPPORTED DEVICES')
    expect(prompt).toContain('- tv')
    expect(prompt).toContain('- salon')
  })

  it('injects preamble and custom instruction', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({ devices: registry })

    const prompt = client.buildPrompt({
      preamble: 'You are a HomeDSL translator.',
      customInstruction: 'Output only HomeDSL.',
    })

    expect(prompt).toContain('You are a HomeDSL translator.')
    expect(prompt).toContain('Output only HomeDSL.')
  })

  it('accepts promptDefinitions passed to the constructor', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({
      devices: registry.getDevices(),
      promptDefinitions: registry.getPromptDefinitions(),
    })

    const prompt = client.buildPrompt()

    expect(prompt).toContain('- tv')
  })

  it('throws when built from a bare Device[] with no definitions', () => {
    const registry = new DeviceRegistry(makeInventory())
    const client = new OpenNestClient({ devices: registry.getDevices() })

    expect(() => client.buildPrompt()).toThrow(/prompt definitions/)
  })
})

describe('OpenNestClient.analyze', () => {
  it('returns ok with no errors for valid DSL', async () => {
    const { client } = await makeClient()

    const feedback = client.analyze('tv[salon].power = on')

    expect(feedback.ok).toBe(true)
    expect(feedback.parseErrors).toHaveLength(0)
    expect(feedback.validationErrors).toHaveLength(0)
    expect(feedback.program).not.toBeNull()
  })

  it('returns parse errors without throwing', async () => {
    const { client } = await makeClient()

    const feedback = client.analyze('??? not valid')

    expect(feedback.ok).toBe(false)
    expect(feedback.parseErrors.length).toBeGreaterThan(0)
    expect(feedback.program).toBeNull()
    expect(feedback.validationErrors).toHaveLength(0)
  })

  it('returns validation errors for an unknown device type', async () => {
    const { client } = await makeClient()

    const feedback = client.analyze('camera[salon].snapshot()')

    expect(feedback.ok).toBe(false)
    expect(feedback.parseErrors).toHaveLength(0)
    expect(feedback.program).not.toBeNull()
    expect(feedback.validationErrors[0]!.message).toContain(
      "No device of type 'camera' found",
    )
  })
})
