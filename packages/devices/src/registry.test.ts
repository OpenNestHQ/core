import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { DeviceRegistry } from './registry.js'

const TEST_YAML = `
drivers:
  mock:
    latency: 0

rooms:
  - salon
  - chambre

devices:
  - id: tv_salon
    type: tv
    room: salon
    name: Salon TV
    driver: mock
    properties:
      power:
        type: boolean
      volume:
        type: number
    actions:
      - play
      - pause

  - id: light_chambre
    type: light
    room: chambre
    name: Chambre Light
    driver: mock
    properties:
      power:
        type: boolean
    actions: []
`

function writeTempYaml(content: string): string {
  const path = '/tmp/test-inventory.yaml'
  writeFileSync(path, content, 'utf-8')
  return path
}

function cleanup(path: string): void {
  if (existsSync(path)) unlinkSync(path)
}

describe('DeviceRegistry', () => {
  describe('fromYaml', () => {
    it('should load devices from a YAML file', () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)
      const devices = registry.getDevices()

      expect(devices).toHaveLength(2)
      cleanup(path)
    })

    it('should populate device id, type, room, name', () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)
      const tv = registry.getDevice('tv_salon')!

      expect(tv.id).toBe('tv_salon')
      expect(tv.type).toBe('tv')
      expect(tv.room).toBe('salon')
      expect(tv.name).toBe('Salon TV')
      cleanup(path)
    })

    it('should attach a driver to each device', () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)
      const tv = registry.getDevice('tv_salon')!

      expect(tv.driver).toBeDefined()
      expect(tv.driver.name).toBe('mock')
      cleanup(path)
    })

    it('should store driverConfig with properties and actions', () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)
      const tv = registry.getDevice('tv_salon')!
      const config = tv.driverConfig as Record<string, unknown>

      expect(config['properties']).toBeDefined()
      expect(config['actions']).toBeDefined()
      const actions = config['actions'] as string[]
      expect(actions).toContain('play')
      expect(actions).toContain('pause')
      cleanup(path)
    })

    it('should return undefined for unknown device', () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)

      expect(registry.getDevice('nonexistent')).toBeUndefined()
      cleanup(path)
    })

    it('should throw for unknown driver name', () => {
      const yaml = `
drivers: {}
rooms: []
devices:
  - id: d1
    type: foo
    room: bar
    name: Foo Bar
    driver: unknown_driver
    properties: {}
    actions: []
`

      const path = writeTempYaml(yaml)
      expect(() => DeviceRegistry.fromYaml(path)).toThrow(/unknown driver/i)
      cleanup(path)
    })
  })

  describe('mock driver interaction', () => {
    it('should allow setting and getting properties through the driver', async () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)
      const tv = registry.getDevice('tv_salon')!

      await tv.driver.setProperty(tv.id, 'power', true, tv.driverConfig)
      const value = await tv.driver.getProperty(tv.id, 'power', tv.driverConfig)
      expect(value).toBe(true)
      cleanup(path)
    })

    it('should seed initial state into the mock driver', async () => {
      const yaml = `
drivers:
  mock:
    latency: 0
rooms: []
devices:
  - id: tv1
    type: tv
    room: salon
    name: TV One
    driver: mock
    properties:
      power:
        type: boolean
      volume:
        type: number
    actions: []
    init:
      power: false
      volume: 20
`
      const path = writeTempYaml(yaml)
      const registry = DeviceRegistry.fromYaml(path)
      const tv = registry.getDevice('tv1')!

      expect(await tv.driver.getProperty(tv.id, 'power', tv.driverConfig)).toBe(
        false,
      )
      expect(
        await tv.driver.getProperty(tv.id, 'volume', tv.driverConfig),
      ).toBe(20)
      cleanup(path)
    })

    it('should allow executing actions through the driver', async () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)
      const tv = registry.getDevice('tv_salon')!

      await expect(
        tv.driver.executeAction(tv.id, 'play', {}, tv.driverConfig),
      ).resolves.toBeUndefined()
      cleanup(path)
    })
  })

  describe('getDriver', () => {
    it('should return driver by name', () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)

      const driver = registry.getDriver('mock')
      expect(driver).toBeDefined()
      expect(driver!.name).toBe('mock')
      cleanup(path)
    })

    it('should return undefined for unknown driver', () => {
      const path = writeTempYaml(TEST_YAML)
      const registry = DeviceRegistry.fromYaml(path)

      expect(registry.getDriver('unknown')).toBeUndefined()
      cleanup(path)
    })
  })

  describe('HA binding validation at load', () => {
    const HA_YAML_HEADER = `
drivers:
  homeassistant:
    url: http://ha.local:8123
    token: test-token

rooms:
  - salon
`

    it('should throw at load on an invalid new format binding', () => {
      const yaml = `${HA_YAML_HEADER}
devices:
  - id: ha_switch
    type: switch
    room: salon
    name: HA Switch
    driver: homeassistant
    properties:
      power:
        type: boolean
        entity: switch.salon
        get:
          kind: levitate
    actions: []
`
      const path = writeTempYaml(yaml)
      expect(() => DeviceRegistry.fromYaml(path)).toThrow(
        /Invalid HA binding for device "ha_switch", property "power": unknown get kind "levitate"/,
      )
      cleanup(path)
    })

    it('should throw at load on an orphan action placeholder', () => {
      const yaml = `${HA_YAML_HEADER}
devices:
  - id: ha_thermostat
    type: thermostat
    room: salon
    name: HA Thermostat
    driver: homeassistant
    properties:
      power:
        type: boolean
        entity: switch.salon
    actions:
      boost:
        kind: script
        script: script.boost
        fields:
          minutes: $minuts
        parameters:
          - name: minutes
            type: number
`
      const path = writeTempYaml(yaml)
      expect(() => DeviceRegistry.fromYaml(path)).toThrow(
        /device "ha_thermostat", action "boost".*orphan placeholder "\$minuts"/,
      )
      cleanup(path)
    })

    it('should load a registry with valid new format bindings', () => {
      const yaml = `${HA_YAML_HEADER}
devices:
  - id: ha_switch
    type: switch
    room: salon
    name: HA Switch
    driver: homeassistant
    properties:
      power:
        type: boolean
        entity: switch.salon
        get:
          kind: state
        set:
          kind: inferred
      away:
        set:
          kind: script
          script: script.set_away
          fields:
            mode: $value
    actions:
      boost:
        kind: script
        script: script.boost
        fields:
          minutes: $minutes
        parameters:
          - name: minutes
            type: number
`
      const path = writeTempYaml(yaml)
      const registry = DeviceRegistry.fromYaml(path)
      expect(registry.getDevice('ha_switch')).toBeDefined()
      cleanup(path)
    })

    it('should not validate old flat format bindings at load', () => {
      const yaml = `${HA_YAML_HEADER}
devices:
  - id: ha_switch
    type: switch
    room: salon
    name: HA Switch
    driver: homeassistant
    properties:
      power:
        type: boolean
        entity: switch.salon
        set_service: bad_format_no_dot
    actions:
      play:
        service: media_player.media_play
`
      const path = writeTempYaml(yaml)
      expect(() => DeviceRegistry.fromYaml(path)).not.toThrow()
      cleanup(path)
    })
  })
})
