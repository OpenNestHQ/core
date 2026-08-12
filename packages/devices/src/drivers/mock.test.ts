import { describe, it, expect } from 'vitest'
import { MockDriver } from './mock.js'

describe('MockDriver', () => {
  it('should init with default latency', async () => {
    const driver = new MockDriver()
    await driver.init({})
    expect(driver.name).toBe('mock')
  })

  it('should init with configured latency', async () => {
    const driver = new MockDriver()
    await driver.init({ latency: 100 })
    expect(driver.name).toBe('mock')
  })

  it('should store and retrieve a property', async () => {
    const driver = new MockDriver()
    await driver.init({})
    await driver.setProperty('d1', 'power', true, {})
    const value = await driver.getProperty('d1', 'power', {})
    expect(value).toBe(true)
  })

  it('should return null for unknown property', async () => {
    const driver = new MockDriver()
    await driver.init({})
    const value = await driver.getProperty('unknown', 'power', {})
    expect(value).toBeNull()
  })

  it('should return null for unknown device', async () => {
    const driver = new MockDriver()
    await driver.init({})
    const value = await driver.getProperty('nonexistent', 'volume', {})
    expect(value).toBeNull()
  })

  it('should overwrite property on second set', async () => {
    const driver = new MockDriver()
    await driver.init({})
    await driver.setProperty('d1', 'volume', 10, {})
    await driver.setProperty('d1', 'volume', 42, {})
    const value = await driver.getProperty('d1', 'volume', {})
    expect(value).toBe(42)
  })

  it('should execute action without error', async () => {
    const driver = new MockDriver()
    await driver.init({})
    await expect(
      driver.executeAction('d1', 'start', {}),
    ).resolves.toBeUndefined()
  })

  it('should seed multiple properties at once', async () => {
    const driver = new MockDriver()
    await driver.init({})
    driver.seed('tv1', { power: false, volume: 20, source: 'hdmi1' })

    expect(await driver.getProperty('tv1', 'power', {})).toBe(false)
    expect(await driver.getProperty('tv1', 'volume', {})).toBe(20)
    expect(await driver.getProperty('tv1', 'source', {})).toBe('hdmi1')
  })

  it('should handle different device IDs independently', async () => {
    const driver = new MockDriver()
    await driver.init({})
    await driver.setProperty('d1', 'power', true, {})
    await driver.setProperty('d2', 'power', false, {})

    expect(await driver.getProperty('d1', 'power', {})).toBe(true)
    expect(await driver.getProperty('d2', 'power', {})).toBe(false)
  })

  it('should expose internal store via getStore()', () => {
    const driver = new MockDriver()
    driver.seed('dev1', { temp: 22 })
    const store = driver.getStore()
    expect(store.has('dev1')).toBe(true)
    expect(store.get('dev1')!.get('temp')).toBe(22)
  })
})
