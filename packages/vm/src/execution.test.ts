import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseHomeDSL } from '@opennest/lang-core'
import type { VerificationStrategy } from '@opennest/lang-core'
import type { DeviceDriver } from '@opennest/devices'
import { executeCommand } from './index.js'
import type { Device } from './index.js'
import { executeAction } from './executor.js'
import { verifyState } from './execution.js'

afterEach(() => {
  vi.useRealTimers()
})

class TestDriver implements DeviceDriver {
  readonly name = 'test'
  state = new Map<string, Record<string, unknown>>()
  actionEffects = new Map<string, Record<string, unknown>>()
  throwOnAction = false
  ignoreWrites = false
  commitDelayMs = 0
  strategy: VerificationStrategy | null = null

  async init(): Promise<void> {}

  async close(): Promise<void> {}

  async getProperty(deviceId: string, property: string): Promise<unknown> {
    return this.state.get(deviceId)?.[property] ?? null
  }

  async setProperty(
    deviceId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    if (this.ignoreWrites) return
    const entry = this.state.get(deviceId) ?? {}
    entry[property] = value
    this.state.set(deviceId, entry)
  }

  async executeAction(deviceId: string, action: string): Promise<void> {
    if (this.throwOnAction) throw new Error('driver boom')
    const effect = this.actionEffects.get(action)
    if (!effect) return
    if (this.commitDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.commitDelayMs))
    }
    const entry = this.state.get(deviceId) ?? {}
    Object.assign(entry, effect)
    this.state.set(deviceId, entry)
  }

  getVerificationStrategy(): VerificationStrategy | null {
    return this.strategy
  }
}

function parse(dsl: string) {
  const result = parseHomeDSL(dsl)
  if (result.errors.length > 0) throw new Error(result.errors[0]!.message)
  return result.program
}

async function makeDevice(
  driver: TestDriver,
  driverConfig: Record<string, unknown> = {},
  id = 'light_salon',
): Promise<Device> {
  await driver.init()
  return { id, type: 'light', room: 'salon', name: id, driver, driverConfig }
}

const TURN_ON = {
  actions: { turnOn: { expectedEffects: { power: true } } },
}

describe('ActionOutcome — verification', () => {
  it('confirmed when the observed state matches the expected effect', async () => {
    const driver = new TestDriver()
    driver.actionEffects.set('turnOn', { power: true })
    const dev = await makeDevice(driver, TURN_ON)

    const result = await executeCommand(
      { kind: 'run_program', program: parse('light[salon].turnOn()') },
      { devices: [dev] },
    )

    expect(result.status).toBe('success')
    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.execution.status).toBe('accepted')
    expect(outcome.verification.status).toBe('confirmed')
    expect(outcome.verification.expected).toEqual({ power: true })
    expect(outcome.verification.observed).toEqual({ power: true })
  })

  it('mismatch when the observed state differs from the expected effect', async () => {
    const driver = new TestDriver()
    // turnOn has an expected effect, but the driver does not apply it
    const dev = await makeDevice(driver, TURN_ON)

    const result = await executeCommand(
      { kind: 'run_program', program: parse('light[salon].turnOn()') },
      { devices: [dev] },
    )

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.execution.status).toBe('accepted')
    expect(outcome.verification.status).toBe('mismatch')
    expect(outcome.verification.expected).toEqual({ power: true })
    expect(outcome.verification.observed).toEqual({ power: null })
  })

  it('not_observable when the action declares no expected effect', async () => {
    const driver = new TestDriver()
    driver.actionEffects.set('turnOn', { power: true })
    const dev = await makeDevice(driver, { actions: { turnOn: {} } })

    const result = await executeCommand(
      { kind: 'run_program', program: parse('light[salon].turnOn()') },
      { devices: [dev] },
    )

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.execution.status).toBe('accepted')
    expect(outcome.verification.status).toBe('not_observable')
    expect(outcome.verification.expected).toBeUndefined()
    expect(outcome.verification.observed).toBeUndefined()
  })

  it('failed when the driver rejects the command', async () => {
    const driver = new TestDriver()
    driver.throwOnAction = true
    const dev = await makeDevice(driver, TURN_ON)

    const result = await executeCommand(
      { kind: 'run_program', program: parse('light[salon].turnOn()') },
      { devices: [dev] },
    )

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.execution.status).toBe('failed')
    expect(outcome.execution.error).toBe('driver boom')
    expect(outcome.verification.status).toBe('not_observable')
  })
})

describe('ActionOutcome — assignment and increment', () => {
  it('confirms a state assignment', async () => {
    const driver = new TestDriver()
    const dev = await makeDevice(driver, {})

    const result = await executeCommand(
      { kind: 'run_program', program: parse('light[salon].power = on') },
      { devices: [dev] },
    )

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.verification.status).toBe('confirmed')
    expect(outcome.verification.expected).toEqual({ power: true })
  })

  it('mismatch when the driver does not persist a write', async () => {
    const driver = new TestDriver()
    driver.ignoreWrites = true
    const dev = await makeDevice(driver, {})

    const result = await executeCommand(
      { kind: 'run_program', program: parse('light[salon].power = on') },
      { devices: [dev] },
    )

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.verification.status).toBe('mismatch')
    expect(outcome.verification.expected).toEqual({ power: true })
    expect(outcome.verification.observed).toEqual({ power: null })
  })

  it('confirms an increment', async () => {
    const driver = new TestDriver()
    driver.state.set('light_salon', { power: false, volume: 10 })
    const dev = await makeDevice(driver, {})

    const result = await executeCommand(
      { kind: 'run_program', program: parse('light[salon].volume += 5') },
      { devices: [dev] },
    )

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.verification.status).toBe('confirmed')
    expect(outcome.verification.expected).toEqual({ volume: 15 })
  })
})

describe('ActionOutcome — polling', () => {
  it('times out when the state never matches within the deadline', async () => {
    vi.useFakeTimers()
    const driver = new TestDriver()
    driver.strategy = { type: 'poll', timeout: 100, interval: 10 }
    const dev = await makeDevice(driver, TURN_ON)

    const promise = executeCommand(
      { kind: 'run_program', program: parse('light[salon].turnOn()') },
      { devices: [dev] },
    )
    await vi.advanceTimersByTimeAsync(200)
    const result = await promise

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.verification.status).toBe('timeout')
    expect(outcome.verification.expected).toEqual({ power: true })
  })

  it('confirms once the state eventually converges', async () => {
    vi.useFakeTimers()
    const driver = new TestDriver()
    driver.strategy = { type: 'poll', timeout: 1000, interval: 20 }
    driver.actionEffects.set('turnOn', { power: true })
    driver.commitDelayMs = 50
    const dev = await makeDevice(driver, TURN_ON)

    const promise = executeCommand(
      { kind: 'run_program', program: parse('light[salon].turnOn()') },
      { devices: [dev] },
    )
    await vi.advanceTimersByTimeAsync(200)
    const result = await promise

    const outcome = result.executed[0]!.outcomes![0]!
    expect(outcome.verification.status).toBe('confirmed')
    expect(outcome.verification.observed).toEqual({ power: true })
  })
})

describe('ActionOutcome — event verification', () => {
  class EventDriver implements DeviceDriver {
    readonly name = 'event'
    state = new Map<string, Record<string, unknown>>()
    subscribable = true
    private listeners = new Set<() => void>()

    async init(): Promise<void> {}
    async close(): Promise<void> {}

    async getProperty(deviceId: string, property: string): Promise<unknown> {
      return this.state.get(deviceId)?.[property] ?? null
    }

    async setProperty(
      deviceId: string,
      property: string,
      value: unknown,
    ): Promise<void> {
      const entry = this.state.get(deviceId) ?? {}
      entry[property] = value
      this.state.set(deviceId, entry)
    }

    async executeAction(): Promise<void> {}

    subscribeProperty(
      _deviceId: string,
      _property: string,
      _deviceConfig: Record<string, unknown>,
      onStateChange: () => void,
    ): (() => void) | null {
      if (!this.subscribable) return null
      this.listeners.add(onStateChange)
      return () => this.listeners.delete(onStateChange)
    }

    emitChange(): void {
      for (const listener of this.listeners) listener()
    }
  }

  async function makeEventDevice(driver: EventDriver): Promise<Device> {
    await driver.init()
    return {
      id: 'light_salon',
      type: 'light',
      room: 'salon',
      name: 'light_salon',
      driver,
      driverConfig: {},
    }
  }

  it('confirms immediately when the state already matches', async () => {
    const driver = new EventDriver()
    driver.state.set('light_salon', { power: true })
    const dev = await makeEventDevice(driver)

    const verification = await verifyState(
      dev,
      { power: true },
      { type: 'event', timeout: 1000 },
      { programId: 'p1' },
    )

    expect(verification.status).toBe('confirmed')
  })

  it('confirms once the driver signals a state change', async () => {
    const driver = new EventDriver()
    driver.state.set('light_salon', { power: false })
    const dev = await makeEventDevice(driver)

    const promise = verifyState(
      dev,
      { power: true },
      { type: 'event', timeout: 1000 },
      { programId: 'p1' },
    )

    await new Promise(resolve => setTimeout(resolve, 0))

    driver.state.set('light_salon', { power: true })
    driver.emitChange()

    const verification = await promise
    expect(verification.status).toBe('confirmed')
    expect(verification.observed).toEqual({ power: true })
  })

  it('falls back to mismatch when the driver cannot subscribe', async () => {
    const driver = new EventDriver()
    driver.subscribable = false
    driver.state.set('light_salon', { power: false })
    const dev = await makeEventDevice(driver)

    const verification = await verifyState(
      dev,
      { power: true },
      { type: 'event', timeout: 1000 },
      { programId: 'p1' },
    )

    expect(verification.status).toBe('mismatch')
    expect(verification.observed).toEqual({ power: false })
  })

  it('times out when no event arrives', async () => {
    vi.useFakeTimers()
    const driver = new EventDriver()
    driver.state.set('light_salon', { power: false })
    const dev = await makeEventDevice(driver)

    const promise = verifyState(
      dev,
      { power: true },
      { type: 'event', timeout: 100 },
      { programId: 'p1' },
    )

    await vi.advanceTimersByTimeAsync(200)
    const verification = await promise
    expect(verification.status).toBe('timeout')
  })
})

describe('backward compatibility', () => {
  it('keeps the low-level executeAction result unchanged', async () => {
    const driver = new TestDriver()
    const dev = await makeDevice(driver, {})

    const change = await executeAction(dev, 'turnOn', undefined, {
      programId: 'p1',
    })

    expect(change).toEqual({
      deviceId: 'light_salon',
      property: 'action:turnOn',
      oldValue: null,
      newValue: 'called',
    })
  })

  it('still executes existing programs end-to-end', async () => {
    const driver = new TestDriver()
    const dev = await makeDevice(driver, {})

    const result = await executeCommand(
      {
        kind: 'run_program',
        program: parse('light[salon].power = on\nlight[salon].volume = 20'),
      },
      { devices: [dev] },
    )

    expect(result.status).toBe('success')
    expect(result.executed).toHaveLength(2)
    expect(await driver.getProperty('light_salon', 'power')).toBe(true)
    expect(await driver.getProperty('light_salon', 'volume')).toBe(20)
  })
})
