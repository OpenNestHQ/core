import { describe, it, expect, vi } from 'vitest'
import { parseHomeDSL } from '@opennest/lang-core'
import type { Segment, PowerValue, Selector } from '@opennest/lang-core'
import { MockDriver } from '@opennest/devices'
import { executeCommand, createSession } from './index.js'
import type {
  Device,
  VMContext,
  Session,
  ExcludedDevice,
  DeviceSelectionInteraction,
  ActionParameterInteraction,
} from './index.js'
import { resumeWithResponse } from './state.js'
import { resolveDevices } from './resolver.js'
import { expandCollection } from './collections.js'
import { executeAssignment, executeQuery, executeAction } from './executor.js'
import { registerHandler, createInteraction } from './interactions/registry.js'
import { deviceSelectionHandler } from './interactions/device-selection.js'
import type { DeviceSelectionContext } from './interactions/device-selection.js'

registerHandler(deviceSelectionHandler)

function makeDriver(): MockDriver {
  return new MockDriver()
}

async function makeDevice(
  id: string,
  type: string,
  room: string,
  name: string,
  driver: MockDriver,
  initialState: Record<string, unknown> = {},
): Promise<Device> {
  await driver.init({})
  driver.seed(id, initialState)
  return {
    id,
    type,
    room,
    name,
    driver,
    driverConfig: {},
  }
}

interface DeviceSpec {
  id: string
  type: string
  room: string
  name: string
  initialState: Record<string, unknown>
}

async function devices(specs?: DeviceSpec[]): Promise<Device[]> {
  const driver = makeDriver()
  const list = specs ?? fixtureSpecs()
  return Promise.all(
    list.map(s =>
      makeDevice(s.id, s.type, s.room, s.name, driver, s.initialState),
    ),
  )
}

function fixtureSpecs(): DeviceSpec[] {
  return [
    {
      id: 'tv_salon',
      type: 'tv',
      room: 'salon',
      name: 'Salon TV',
      initialState: { power: false, volume: 15 },
    },
    {
      id: 'tv_chambre',
      type: 'tv',
      room: 'chambre',
      name: 'Chambre TV',
      initialState: { power: false, volume: 10 },
    },
    {
      id: 'light_salon_1',
      type: 'light',
      room: 'salon',
      name: 'Salon Light 1',
      initialState: { power: false, brightness: 80 },
    },
    {
      id: 'light_salon_2',
      type: 'light',
      room: 'salon',
      name: 'Salon Light 2',
      initialState: { power: true, brightness: 60 },
    },
    {
      id: 'thermostat_salon',
      type: 'thermostat',
      room: 'salon',
      name: 'Salon Thermostat',
      initialState: { temperature: 21 },
    },
    {
      id: 'vacuum_salon',
      type: 'vacuum',
      room: 'salon',
      name: 'Salon Vacuum',
      initialState: {},
    },
    {
      id: 'speaker_salon',
      type: 'speaker',
      room: 'salon',
      name: 'Salon Speaker',
      initialState: { power: false, volume: 30 },
    },
  ]
}

async function ctx(session?: Session): Promise<VMContext> {
  return { devices: await devices(), session }
}

function parse(code: string) {
  const result = parseHomeDSL(code)
  if (result.errors.length > 0) {
    throw new Error(
      `Parse errors: ${result.errors.map(e => e.message).join(', ')}`,
    )
  }
  return result.program
}

function seg(identifier: string, room?: string, isVariable?: boolean): Segment {
  const base =
    room === '*'
      ? { identifier, selectors: [{ kind: 'wildcard' as const }] }
      : room
        ? { identifier, selectors: [{ kind: 'room' as const, name: room }] }
        : { identifier, selectors: [] as Selector[] }
  return isVariable ? { ...base, isVariable: true } : base
}

function on(): PowerValue {
  return { kind: 'power', value: 'on' }
}

async function getProperty(d: Device, prop: string): Promise<unknown> {
  return d.driver.getProperty(d.id, prop, d.driverConfig)
}

function resolveDevice(session: Session, deviceId: string): Session {
  return resumeWithResponse(session, {
    interactionId: session.pendingInteraction!.id,
    type: 'device_selection',
    deviceId,
  })
}

describe('interpret_home_dsl', () => {
  describe('basic assignments', () => {
    it('should assign a property on an unambiguous device', async () => {
      const program = parse('tv[salon].power = on')
      const context = await ctx()
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(1)
      const exec = result.executed[0]!
      expect(exec.resolvedDevices).toHaveLength(1)
      expect(exec.resolvedDevices[0]!.id).toBe('tv_salon')
      expect(exec.changes[0]!.property).toBe('power')
      expect(exec.changes[0]!.newValue).toBe(true)

      const value = await getProperty(exec.resolvedDevices[0]!, 'power')
      expect(value).toBe(true)
    })

    it('should assign a numeric value', async () => {
      const program = parse('tv[salon].volume = 42')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.changes[0]!.newValue).toBe(42)
    })

    it('should assign a string value', async () => {
      const program = parse(`tv[salon].source = "hdmi1"`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.changes[0]!.newValue).toBe('hdmi1')
    })

    it('should assign to a wildcard room selector (all rooms)', async () => {
      const program = parse('tv[*].power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.resolvedDevices).toHaveLength(2)
      const ids = result.executed[0]!.resolvedDevices.map(d => d.id)
      expect(ids).toContain('tv_salon')
      expect(ids).toContain('tv_chambre')
    })
  })

  describe('queries', () => {
    it('should query a device property', async () => {
      const program = parse('thermostat[salon].temperature?')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.changes[0]!.newValue).toBe(21)
    })

    it('should query tv power', async () => {
      const program = parse('tv[salon].power?')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.changes[0]!.newValue).toBe(false)
    })
  })

  describe('increments', () => {
    it('should increment a numeric property', async () => {
      const program = parse('tv[salon].volume += 5')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.changes[0]!.oldValue).toBe(15)
      expect(result.executed[0]!.changes[0]!.newValue).toBe(20)
    })
  })

  describe('actions', () => {
    it('should execute an action on a device', async () => {
      const program = parse('vacuum[salon].start()')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      const change = result.executed[0]!.changes[0]!
      expect(change.property).toBe('action:start')
      expect(change.newValue).toBe('called')
    })
  })

  describe('variable assignments', () => {
    it('should store a variable reference', async () => {
      const program = parse('$salon_tv = tv[salon]')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.session.variables['salon_tv']).toEqual({
        kind: 'device_ref',
        deviceType: 'tv',
        selectors: [{ kind: 'room', name: 'salon' }],
      })
    })

    it('should use a variable to reference a device', async () => {
      const program = parse(`$salon_tv = tv[salon]\n$salon_tv.power = on`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)
      const assignmentResult = result.executed[1]!
      expect(assignmentResult.resolvedDevices[0]!.id).toBe('tv_salon')
      expect(assignmentResult.changes[0]!.newValue).toBe(true)
    })

    it('should store a collection variable', async () => {
      const program = parse('$lights = @all(light[salon])')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.session.variables['lights']).toEqual({
        kind: 'device_ref',
        deviceType: 'light',
        selectors: [{ kind: 'room', name: 'salon' }],
      })
    })
  })

  describe('context reference (it)', () => {
    it("should use 'it' to reference the last resolved device", async () => {
      const program = parse(`tv[salon].volume = 20\n$it.power = on`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)

      const secondExecution = result.executed[1]!
      expect(secondExecution.resolvedDevices[0]!.id).toBe('tv_salon')
      expect(secondExecution.changes[0]!.property).toBe('power')
      expect(secondExecution.changes[0]!.newValue).toBe(true)
    })

    it("should error when 'it' is used before any resolution", async () => {
      const program = parse('$it.power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('error')
    })

    it("should carry 'it' across sessions", async () => {
      const program1 = parse('tv[salon].volume = 30')
      const context1 = await ctx()
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context1,
      )

      expect(result1.session.it?.id).toBe('tv_salon')

      const program2 = parse('$it.power = on')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context1.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(result2.executed[0]!.resolvedDevices[0]!.id).toBe('tv_salon')
    })
  })

  describe('ambiguity handling', () => {
    it('should return awaiting_interaction state when device type is ambiguous (no room)', async () => {
      const program = parse('tv.power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('awaiting_interaction')
      expect(result.interaction).not.toBeNull()
      expect(result.interaction!.type).toBe('device_selection')

      const sel = result.interaction as DeviceSelectionInteraction
      expect(sel.devices).toHaveLength(2)
      expect(sel.devices[0]!.type).toBe('tv')

      const salonDevs = sel.devices.filter(d => d.room === 'salon')
      expect(salonDevs).toHaveLength(1)
      expect(salonDevs[0]!.name).toBe('Salon TV')
      expect(salonDevs[0]!.id).toBe('tv_salon')

      const chambreDevs = sel.devices.filter(d => d.room === 'chambre')
      expect(chambreDevs).toHaveLength(1)
      expect(chambreDevs[0]!.name).toBe('Chambre TV')
      expect(chambreDevs[0]!.id).toBe('tv_chambre')
    })

    it('should not be ambiguous when room is specified', async () => {
      const program = parse('tv[salon].power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
    })

    it('should not be ambiguous for a single device type across rooms', async () => {
      const program = parse('thermostat.power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).not.toBe('awaiting_interaction')
    })

    it('should include device ids and names in device_selection interaction', async () => {
      const program = parse('tv.power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      const sel = result.interaction as DeviceSelectionInteraction
      for (const device of sel.devices) {
        expect(device.id).toBeDefined()
        expect(typeof device.id).toBe('string')
        expect(device.name).toBeDefined()
        expect(device.room).toBeDefined()
      }
    })
  })

  describe('multi-turn ambiguity resolution', () => {
    it('should resolve ambiguity and re-interpret the same program', async () => {
      const program = parse('tv.power = on')
      const context = await ctx()
      const result1 = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result1.status).toBe('awaiting_interaction')
      expect(result1.interaction).not.toBeNull()
      expect(result1.executed).toHaveLength(0)

      resolveDevice(result1.session, 'tv_salon')

      const result2 = await executeCommand(
        { kind: 'run_program', program: program },
        { devices: context.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(result2.executed).toHaveLength(1)
      expect(result2.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result2.executed[0]!.resolvedDevices[0]!.id).toBe('tv_salon')
      expect(result2.executed[0]!.changes[0]!.property).toBe('power')
      expect(result2.executed[0]!.changes[0]!.newValue).toBe(true)
    })

    it('should not re-execute statements before the ambiguity', async () => {
      const program = parse(
        'tv[salon].volume = 30\ntv.power = on\nspeaker[salon].volume = 20',
      )
      const context = await ctx()

      const result1 = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )
      expect(result1.status).toBe('awaiting_interaction')
      expect(result1.executed).toHaveLength(1)
      expect(result1.executed[0]!.changes[0]!.property).toBe('volume')
      expect(result1.executed[0]!.changes[0]!.newValue).toBe(30)

      resolveDevice(result1.session, 'tv_chambre')

      const result2 = await executeCommand(
        { kind: 'run_program', program: program },
        { devices: context.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(result2.executed).toHaveLength(3)

      const firstExec = result2.executed[0]!
      expect(firstExec.changes[0]!.property).toBe('volume')
      expect(firstExec.changes[0]!.newValue).toBe(30)

      const secondExec = result2.executed[1]!
      expect(secondExec.resolvedDevices[0]!.id).toBe('tv_chambre')
      expect(secondExec.changes[0]!.property).toBe('power')
      expect(secondExec.changes[0]!.newValue).toBe(true)

      const thirdExec = result2.executed[2]!
      expect(thirdExec.resolvedDevices[0]!.type).toBe('speaker')
    })

    it('should be ambiguous on direct references even after previous resolution', async () => {
      const context = await ctx()
      const program1 = parse('tv.power = on')
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context,
      )

      resolveDevice(result1.session, 'tv_salon')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program1 },
        { devices: context.devices, session: result1.session },
      )
      expect(result2.status).toBe('success')

      const program2 = parse('tv.power = off')
      const result3 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context.devices, session: result2.session },
      )

      expect(result3.status).toBe('awaiting_interaction')
    })

    it("should be ambiguous again if resolved id doesn't match the room", async () => {
      const context = await ctx()
      const program1 = parse('tv.power = on')
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context,
      )

      resolveDevice(result1.session, 'tv_salon')

      const program2 = parse('tv[chambre].power = on')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(result2.executed[0]!.resolvedDevices[0]!.id).toBe('tv_chambre')
    })
  })

  describe('variable resolution persistence', () => {
    async function multiTvSalonCtx(): Promise<VMContext> {
      const driver = makeDriver()
      await driver.init({})

      const tv1: Device = {
        id: 'tv_lg_salon',
        type: 'tv',
        room: 'salon',
        name: 'LG OLED',
        driver,
        driverConfig: {},
      }
      const tv2: Device = {
        id: 'tv_samsung_salon',
        type: 'tv',
        room: 'salon',
        name: 'Samsung QLED',
        driver,
        driverConfig: {},
      }
      driver.seed('tv_lg_salon', { power: false, volume: 15 })
      driver.seed('tv_samsung_salon', { power: false, volume: 10 })

      return { devices: [tv1, tv2] }
    }

    it('should auto-resolve variable after previous resolution', async () => {
      const context = await multiTvSalonCtx()
      const program = parse(`$my_tv = tv[salon]\n$my_tv.power = on`)
      const result1 = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result1.status).toBe('awaiting_interaction')

      resolveDevice(result1.session, 'tv_samsung_salon')

      const result2 = await executeCommand(
        { kind: 'run_program', program: program },
        { devices: context.devices, session: result1.session },
      )
      expect(result2.status).toBe('success')
      expect(
        result2.executed[result2.executed.length - 1]!.resolvedDevices[0]!.id,
      ).toBe('tv_samsung_salon')
    })

    it('should auto-resolve variable across programs after resolution', async () => {
      const context = await multiTvSalonCtx()

      const program1 = parse(`$my_tv = tv[salon]\n$my_tv.power = on`)
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context,
      )
      expect(result1.status).toBe('awaiting_interaction')

      resolveDevice(result1.session, 'tv_samsung_salon')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program1 },
        { devices: context.devices, session: result1.session },
      )
      expect(result2.status).toBe('success')

      const program2 = parse('$my_tv.volume = 50')
      const result3 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context.devices, session: result2.session },
      )

      expect(result3.status).toBe('success')
      const lastExec = result3.executed[result3.executed.length - 1]!
      expect(lastExec.resolvedDevices[0]!.id).toBe('tv_samsung_salon')
      expect(lastExec.changes[0]!.newValue).toBe(50)
    })

    it('should invalidate variable resolution on re-assignment', async () => {
      const context = await multiTvSalonCtx()

      const program1 = parse(`$my_tv = tv[salon]\n$my_tv.power = on`)
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context,
      )
      resolveDevice(result1.session, 'tv_samsung_salon')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program1 },
        { devices: context.devices, session: result1.session },
      )
      expect(result2.status).toBe('success')

      const program2 = parse(`$my_tv = tv\n$my_tv.power = off`)
      const result3 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context.devices, session: result2.session },
      )

      expect(result3.status).toBe('awaiting_interaction')
    })

    it('should not auto-resolve direct references unlike variables', async () => {
      const context = await ctx()

      const program1 = parse('tv.power = on')
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context,
      )
      resolveDevice(result1.session, 'tv_salon')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program1 },
        { devices: context.devices, session: result1.session },
      )
      expect(result2.status).toBe('success')

      const program2 = parse('tv.volume = 50')
      const result3 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context.devices, session: result2.session },
      )

      expect(result3.status).toBe('awaiting_interaction')
    })
  })

  describe('ambiguity with room selector and multiple devices', () => {
    async function multiDeviceCtx(): Promise<VMContext> {
      const driver = makeDriver()
      await driver.init({})

      const tv1: Device = {
        id: 'tv_lg_salon',
        type: 'tv',
        room: 'salon',
        name: 'LG OLED',
        driver,
        driverConfig: {},
      }
      const tv2: Device = {
        id: 'tv_samsung_salon',
        type: 'tv',
        room: 'salon',
        name: 'Samsung QLED',
        driver,
        driverConfig: {},
      }
      driver.seed('tv_lg_salon', { power: false, volume: 15 })
      driver.seed('tv_samsung_salon', { power: false, volume: 10 })

      return { devices: [tv1, tv2] }
    }

    it('should be ambiguous when room selector has multiple devices', async () => {
      const ctx = await multiDeviceCtx()
      const program = parse('tv[salon].power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        ctx,
      )

      expect(result.status).toBe('awaiting_interaction')
      expect(result.interaction).not.toBeNull()

      const sel = result.interaction as DeviceSelectionInteraction
      const salonDevs = sel.devices.filter(d => d.room === 'salon')
      expect(salonDevs).toHaveLength(2)
    })

    it('should resolve multi-device room ambiguity with resumeWithResponse', async () => {
      const ctx = await multiDeviceCtx()
      const program = parse('tv[salon].power = on')
      const result1 = await executeCommand(
        { kind: 'run_program', program: program },
        ctx,
      )

      expect(result1.status).toBe('awaiting_interaction')

      resolveDevice(result1.session, 'tv_samsung_salon')

      const result2 = await executeCommand(
        { kind: 'run_program', program: program },
        { devices: ctx.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(result2.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result2.executed[0]!.resolvedDevices[0]!.id).toBe(
        'tv_samsung_salon',
      )
    })
  })

  describe('multi-line programs', () => {
    it('should execute multiple statements in order', async () => {
      const program = parse(
        `tv[salon].power = on\ntv[salon].volume = 25\nspeaker[salon].volume = 30`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(3)
    })

    it('should stop at the first ambiguous statement', async () => {
      const program = parse(
        `tv[salon].power = on\ntv.power = on\nlight[salon].power = on`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('awaiting_interaction')
      expect(result.executed).toHaveLength(1)
    })

    it('should execute all statements with explicit room selectors', async () => {
      const program = parse(`tv[salon].power = on\nspeaker[salon].volume = 20`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)
    })
  })

  describe('session persistence', () => {
    it('should track execution history', async () => {
      const program = parse(`tv[salon].power = on\nspeaker[salon].volume = 20`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.session.history).toHaveLength(2)
    })

    it('should persist variables across calls', async () => {
      const program1 = parse('$salon_tv = tv[salon]')
      const context1 = await ctx()
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context1,
      )

      const program2 = parse('$salon_tv.volume = 50')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context1.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(result2.session.variables['salon_tv']).toBeDefined()
      const lastExec = result2.executed[result2.executed.length - 1]!
      expect(lastExec.resolvedDevices[0]!.id).toBe('tv_salon')
    })

    it('should accumulate history across calls', async () => {
      const program1 = parse('tv[salon].power = on')
      const context1 = await ctx()
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context1,
      )

      const program2 = parse('speaker[salon].volume = 10')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context1.devices, session: result1.session },
      )

      expect(result2.session.history).toHaveLength(2)
    })

    it('should accumulate history across calls', async () => {
      const program1 = parse('tv[salon].power = on')
      const context1 = await ctx()
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context1,
      )

      const program2 = parse('speaker[salon].volume = 10')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context1.devices, session: result1.session },
      )

      expect(result2.session.history).toHaveLength(2)
    })
  })

  describe('error cases', () => {
    it('should error when no devices match the type', async () => {
      const program = parse('camera[salon].snapshot()')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('error')
      expect(result.errors[0]!.message).toContain(
        "No device of type 'camera' found",
      )
    })

    it('should error when no devices match the room', async () => {
      const program = parse('tv[cuisine].power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('error')
    })
  })

  describe('executor module', () => {
    it('should mutate device state on assignment', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('test_light', { power: false })
      const device: Device = {
        id: 'test_light',
        type: 'light',
        room: 'test',
        name: 'Test',
        driver,
        driverConfig: {},
      }

      const change = await executeAssignment(device, 'power', on())

      expect(change.newValue).toBe(true)
      const storedValue = await driver.getProperty('test_light', 'power')
      expect(storedValue).toBe(true)
    })

    it('should read device state on query', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('test_light', { brightness: 50 })
      const device: Device = {
        id: 'test_light',
        type: 'light',
        room: 'test',
        name: 'Test',
        driver,
        driverConfig: {},
      }

      const change = await executeQuery(device, 'brightness')

      expect(change.newValue).toBe(50)
    })

    it('should record action execution', async () => {
      const driver = makeDriver()
      await driver.init({})
      const device: Device = {
        id: 'test_vacuum',
        type: 'vacuum',
        room: 'test',
        name: 'Test',
        driver,
        driverConfig: {},
      }

      const change = await executeAction(device, 'start')

      expect(change.property).toBe('action:start')
      expect(change.newValue).toBe('called')
    })
  })

  describe('resolver module', () => {
    it('should match device by type and room', async () => {
      const devs = await devices()
      const result = resolveDevices([seg('tv', 'salon')], devs, createSession())

      expect(result.devices).toHaveLength(1)
      expect(result.devices[0]!.id).toBe('tv_salon')
      expect(result.ambiguous).toBe(false)
    })

    it('should match all devices of a type with wildcard', async () => {
      const devs = await devices()
      const result = resolveDevices([seg('light', '*')], devs, createSession())

      expect(result.devices).toHaveLength(2)
      expect(result.ambiguous).toBe(false)
    })

    it('should detect ambiguity when no room selector on multi-instance type', async () => {
      const devs = await devices()
      const result = resolveDevices([seg('tv')], devs, createSession())

      expect(result.ambiguous).toBe(true)
      expect(result.devices).toHaveLength(2)
    })

    it('should not be ambiguous for a type with a single instance', async () => {
      const devs = await devices()
      const result = resolveDevices([seg('thermostat')], devs, createSession())

      expect(result.ambiguous).toBe(false)
      expect(result.devices).toHaveLength(1)
    })

    it('should resolve variables', async () => {
      const devs = await devices()
      const session = createSession()
      session.variables['salon_tv'] = {
        kind: 'device_ref',
        deviceType: 'tv',
        selectors: [{ kind: 'room', name: 'salon' }],
      }

      const result = resolveDevices(
        [seg('salon_tv', undefined, true), seg('power')],
        devs,
        session,
      )

      expect(result.devices).toHaveLength(1)
      expect(result.devices[0]!.id).toBe('tv_salon')
    })

    it("should resolve '$it' context reference", async () => {
      const devs = await devices()
      const session = createSession()
      session.it = devs.find(d => d.id === 'tv_salon')!

      const result = resolveDevices(
        [seg('it', undefined, true), seg('power')],
        devs,
        session,
      )

      expect(result.devices).toHaveLength(1)
      expect(result.devices[0]!.id).toBe('tv_salon')
    })

    it("should return empty when '$it' is not set", async () => {
      const devs = await devices()
      const result = resolveDevices(
        [seg('it', undefined, true), seg('power')],
        devs,
        createSession(),
      )

      expect(result.devices).toHaveLength(0)
    })
  })

  describe('collection expansion', () => {
    it('should expand @all for a collection', async () => {
      const devs = await devices()
      const result = expandCollection(
        {
          kind: 'collection',
          modifier: '@all',
          device: {
            deviceType: 'light',
            selectors: [{ kind: 'room', name: 'salon' }],
          },
        },
        devs,
        createSession(),
      )

      expect(result.devices).toHaveLength(2)
    })

    it('should expand @first for a collection', async () => {
      const devs = await devices()
      const result = expandCollection(
        {
          kind: 'collection',
          modifier: '@first',
          device: {
            deviceType: 'light',
            selectors: [{ kind: 'room', name: 'salon' }],
          },
        },
        devs,
        createSession(),
      )

      expect(result.devices).toHaveLength(1)
      expect(result.ambiguous).toBe(false)
    })
  })

  describe('interaction module', () => {
    it('should create device_selection interaction', async () => {
      const devs = await devices()
      const tvDevices = devs.filter(d => d.type === 'tv')
      const ctx: DeviceSelectionContext = {
        devices: tvDevices,
        deviceType: 'tv',
        variableName: undefined,
      }
      const interaction = createInteraction('device_selection', ctx)
      const sel = interaction as DeviceSelectionInteraction

      expect(sel.type).toBe('device_selection')
      expect(sel.devices).toHaveLength(2)
      expect(sel.devices[0]!.type).toBe('tv')
      expect(sel.id).toBeDefined()
    })

    it('should include device details in interaction', async () => {
      const devs = await devices()
      const tvDevices = devs.filter(d => d.type === 'tv')
      const ctx: DeviceSelectionContext = {
        devices: tvDevices,
        deviceType: 'tv',
        variableName: undefined,
      }
      const interaction = createInteraction('device_selection', ctx)
      const sel = interaction as DeviceSelectionInteraction

      const salonDevs = sel.devices.filter(d => d.room === 'salon')
      expect(salonDevs).toHaveLength(1)
      expect(salonDevs[0]!.name).toBe('Salon TV')
      expect(salonDevs[0]!.id).toBe('tv_salon')

      const chambreDevs = sel.devices.filter(d => d.room === 'chambre')
      expect(chambreDevs).toHaveLength(1)
      expect(chambreDevs[0]!.name).toBe('Chambre TV')
      expect(chambreDevs[0]!.id).toBe('tv_chambre')
    })
  })

  describe('conditional blocks (@if)', () => {
    it('should execute body when condition is true', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true, brightness: 80 })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on\ntv[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const tvPwr = await driver.getProperty('tv_1', 'power')
      expect(tvPwr).toBe(true)
    })

    it('should NOT execute body when condition is false', async () => {
      const program = parse(
        `@if light[salon].power? == "on"\ntv[salon].power = on\n@endif`,
      )
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: false, brightness: 50 })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const tvPwr = await driver.getProperty('tv_1', 'power')
      expect(tvPwr).toBe(false)
    })

    it('should execute body when condition is true (power value)', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on\ntv[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const tvPwr = await driver.getProperty('tv_1', 'power')
      expect(tvPwr).toBe(true)
    })

    it('should execute else body when condition is false', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: false })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on\ntv[salon].power = on\n@else\ntv[salon].power = off\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const tvPwr = await driver.getProperty('tv_1', 'power')
      expect(tvPwr).toBe(false)
    })

    it('should not execute else body when condition is true', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on\ntv[salon].volume = 40\n@else\ntv[salon].volume = 10\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const tvVol = await driver.getProperty('tv_1', 'volume')
      expect(tvVol).toBe(40)
    })

    it('should evaluate condition with variable reference', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_salon_1', { power: true, brightness: 80 })
      driver.seed('light_cuisine_1', { power: false, brightness: 60 })
      const devs: Device[] = [
        {
          id: 'light_salon_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'light_cuisine_1',
          type: 'light',
          room: 'cuisine',
          name: 'Cuisine Light',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `$light_salon = light[salon]\n$light_cuisine = light[cuisine]\n@if $light_salon.power? == on\n$light_cuisine.power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const cuisinePwr = await driver.getProperty('light_cuisine_1', 'power')
      expect(cuisinePwr).toBe(true)
    })

    it('should not execute when variable condition is false', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_salon_1', { power: false, brightness: 80 })
      driver.seed('light_cuisine_1', { power: false, brightness: 60 })
      const devs: Device[] = [
        {
          id: 'light_salon_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'light_cuisine_1',
          type: 'light',
          room: 'cuisine',
          name: 'Cuisine Light',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `$light_salon = light[salon]\n@if $light_salon.power? == on\nlight[cuisine].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const cuisinePwr = await driver.getProperty('light_cuisine_1', 'power')
      expect(cuisinePwr).toBe(false)
    })

    it('should evaluate != operator correctly', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: false })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? != on\ntv[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const tvPwr = await driver.getProperty('tv_1', 'power')
      expect(tvPwr).toBe(true)
    })

    it('should evaluate numeric comparison correctly', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('thermostat_1', { temperature: 21 })
      driver.seed('fan_1', { power: false, speed: 0 })
      const devs: Device[] = [
        {
          id: 'thermostat_1',
          type: 'thermostat',
          room: 'salon',
          name: 'Salon Thermostat',
          driver,
          driverConfig: {},
        },
        {
          id: 'fan_1',
          type: 'fan',
          room: 'salon',
          name: 'Salon Fan',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if thermostat[salon].temperature? == 21\nfan[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const fanPwr = await driver.getProperty('fan_1', 'power')
      expect(fanPwr).toBe(true)
    })

    it('should handle nested @if blocks', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('tv_1', { power: true, volume: 15 })
      driver.seed('light_1', { power: false, brightness: 80 })
      driver.seed('speaker_1', { power: false, volume: 30 })
      const devs: Device[] = [
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'speaker_1',
          type: 'speaker',
          room: 'salon',
          name: 'Salon Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if tv[salon].power? == on\n@if light[salon].power? == on\nspeaker[salon].power = on\n@endif\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('speaker_1', 'power')
      // Outer condition is true (tv is on), inner condition is false (light is off)
      expect(spkPwr).toBe(false)
    })

    it('should execute nested @if when both conditions are true', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('tv_1', { power: true, volume: 15 })
      driver.seed('light_1', { power: true, brightness: 80 })
      driver.seed('speaker_1', { power: false, volume: 30 })
      const devs: Device[] = [
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'speaker_1',
          type: 'speaker',
          room: 'salon',
          name: 'Salon Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if tv[salon].power? == on\n@if light[salon].power? == on\nspeaker[salon].power = on\n@endif\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('speaker_1', 'power')
      expect(spkPwr).toBe(true)
    })

    it('should record condition in session history', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true, brightness: 80 })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on\ntv[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const lastEntry =
        result.session.history[result.session.history.length - 1]
      expect(lastEntry!.changes[0]!.property).toBe('condition')
      expect(lastEntry!.changes[0]!.newValue).toBe(true)
    })

    it('should set $it to condition device after evaluating condition', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true, brightness: 50 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on\n$it.brightness = 80\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const brightness = await driver.getProperty('light_1', 'brightness')
      expect(brightness).toBe(80)
    })

    it('should handle empty body (true condition)', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true, brightness: 80 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(`@if light[salon].power? == on\n@endif`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
    })

    it('should handle empty body with @else (false condition)', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: false })
      driver.seed('tv_1', { power: false, volume: 10 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on\n@else\ntv[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const tvPwr = await driver.getProperty('tv_1', 'power')
      expect(tvPwr).toBe(true)
    })

    it('should error when condition device is ambiguous (no room)', async () => {
      const program = parse(`@if tv.power? == on\nspeaker.power = on\n@endif`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('error')
      expect(result.errors[0]!.message).toMatch(/Ambiguous device/)
    })

    it('should handle string comparison in condition', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('tv_1', { power: false, source: 'hdmi1', volume: 10 })
      const devs: Device[] = [
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if tv[salon].source? == "hdmi1"\ntv[salon].volume = 50\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const vol = await driver.getProperty('tv_1', 'volume')
      expect(vol).toBe(50)
    })

    it('should execute body when both & conditions are true', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true, brightness: 80 })
      driver.seed('tv_1', { power: true, volume: 10 })
      driver.seed('speaker_1', { power: false })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
        {
          id: 'speaker_1',
          type: 'speaker',
          room: 'salon',
          name: 'Salon Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on & tv[salon].power? == on\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('speaker_1', 'power')
      expect(spkPwr).toBe(true)
    })

    it('should NOT execute body when one & condition is false', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: true, brightness: 80 })
      driver.seed('tv_1', { power: false, volume: 10 })
      driver.seed('speaker_1', { power: false, volume: 30 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
        {
          id: 'speaker_1',
          type: 'speaker',
          room: 'salon',
          name: 'Salon Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on & tv[salon].power? == on\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('speaker_1', 'power', {})
      expect(spkPwr).toBe(false)
    })

    it('should execute body when one | condition is true', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: false, brightness: 80 })
      driver.seed('tv_1', { power: true, volume: 10 })
      driver.seed('speaker_1', { power: false, volume: 30 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
        {
          id: 'speaker_1',
          type: 'speaker',
          room: 'salon',
          name: 'Salon Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on | tv[salon].power? == on\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('speaker_1', 'power', {})
      expect(spkPwr).toBe(true)
    })

    it('should NOT execute body when both | conditions are false', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: false, brightness: 80 })
      driver.seed('tv_1', { power: false, volume: 10 })
      driver.seed('speaker_1', { power: false, volume: 30 })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
        {
          id: 'speaker_1',
          type: 'speaker',
          room: 'salon',
          name: 'Salon Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if light[salon].power? == on | tv[salon].power? == on\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('speaker_1', 'power', {})
      expect(spkPwr).toBe(false)
    })

    it('should evaluate parentheses correctly', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('light_1', { power: false })
      driver.seed('tv_1', { power: true, volume: 10 })
      driver.seed('speaker_1', { power: false })
      const devs: Device[] = [
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Salon Light',
          driver,
          driverConfig: {},
        },
        {
          id: 'tv_1',
          type: 'tv',
          room: 'salon',
          name: 'Salon TV',
          driver,
          driverConfig: {},
        },
        {
          id: 'speaker_1',
          type: 'speaker',
          room: 'salon',
          name: 'Salon Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }

      const program = parse(
        `@if (light[salon].power? == on | tv[salon].power? == on) & tv[salon].power? == on\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('speaker_1', 'power', {})
      expect(spkPwr).toBe(true)
    })

    it('should evaluate & with higher precedence than |', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('a', { power: true })
      driver.seed('b', { power: false })
      driver.seed('c', { power: false })
      driver.seed('spk', { power: false })
      const devs: Device[] = [
        {
          id: 'a',
          type: 'light',
          room: 'salon',
          name: 'A',
          driver,
          driverConfig: {},
        },
        {
          id: 'b',
          type: 'light',
          room: 'chambre',
          name: 'B',
          driver,
          driverConfig: {},
        },
        {
          id: 'c',
          type: 'light',
          room: 'cuisine',
          name: 'C',
          driver,
          driverConfig: {},
        },
        {
          id: 'spk',
          type: 'speaker',
          room: 'salon',
          name: 'Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }
      // a?==on & b?==on | c?==on → (true & false) | false → false → body NOT executed
      const program = parse(
        `@if light[salon].power? == on & light[chambre].power? == on | light[cuisine].power? == on\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      // Condition is false → only the if-statement history entry, no assignment
      const lastEntry =
        result.session.history[result.session.history.length - 1]
      expect(lastEntry!.changes[0]!.newValue).toBe(false)
    })

    it('should evaluate | before & when parenthesized', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('a', { power: false })
      driver.seed('b', { power: true })
      driver.seed('c', { power: false })
      driver.seed('spk', { power: false })
      const devs: Device[] = [
        {
          id: 'a',
          type: 'light',
          room: 'salon',
          name: 'A',
          driver,
          driverConfig: {},
        },
        {
          id: 'b',
          type: 'light',
          room: 'chambre',
          name: 'B',
          driver,
          driverConfig: {},
        },
        {
          id: 'c',
          type: 'light',
          room: 'cuisine',
          name: 'C',
          driver,
          driverConfig: {},
        },
        {
          id: 'spk',
          type: 'speaker',
          room: 'salon',
          name: 'Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }
      // a?==on | (b?==on & c?==on) → false | (true & false) → false | false → false
      const program = parse(
        `@if light[salon].power? == on | (light[chambre].power? == on & light[cuisine].power? == on)\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const lastEntry =
        result.session.history[result.session.history.length - 1]
      expect(lastEntry!.changes[0]!.newValue).toBe(false)
    })

    it('should handle compound condition with three & conditions using variables', async () => {
      const driver = makeDriver()
      await driver.init({})
      driver.seed('a', { power: true })
      driver.seed('b', { power: true })
      driver.seed('c', { power: true })
      driver.seed('spk', { power: false })
      const devs: Device[] = [
        {
          id: 'a',
          type: 'light',
          room: 'salon',
          name: 'A',
          driver,
          driverConfig: {},
        },
        {
          id: 'b',
          type: 'light',
          room: 'chambre',
          name: 'B',
          driver,
          driverConfig: {},
        },
        {
          id: 'c',
          type: 'light',
          room: 'cuisine',
          name: 'C',
          driver,
          driverConfig: {},
        },
        {
          id: 'spk',
          type: 'speaker',
          room: 'salon',
          name: 'Speaker',
          driver,
          driverConfig: {},
        },
      ]
      const context: VMContext = { devices: devs }
      const program = parse(
        `$a = light[salon]\n$b = light[chambre]\n$c = light[cuisine]\n@if $a.power? == on & $b.power? == on & $c.power? == on\nspeaker[salon].power = on\n@endif`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )

      expect(result.status).toBe('success')
      const spkPwr = await driver.getProperty('spk', 'power', {})
      expect(spkPwr).toBe(true)
    })
  })

  describe('README example flows', () => {
    it('should turn on all lights in the living room', async () => {
      const program = parse(`$lights = @all(light[salon])\n$lights.power = on`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)

      const assignExec = result.executed[1]!
      expect(assignExec.resolvedDevices).toHaveLength(2)

      for (const d of assignExec.resolvedDevices) {
        const pwr = await getProperty(d, 'power')
        expect(pwr).toBe(true)
      }
    })

    it('should turn on only the first light with @first', async () => {
      const program = parse(
        `$first_light = @first(light[salon])\n$first_light.power = on`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)

      const assignExec = result.executed[1]!
      expect(assignExec.resolvedDevices).toHaveLength(1)
      const device = assignExec.resolvedDevices[0]!
      expect(device.type).toBe('light')
      expect(device.room).toBe('salon')

      const pwr = await getProperty(device, 'power')
      expect(pwr).toBe(true)
    })

    it('should resolve @first across multiple programs', async () => {
      const program1 = parse('$my_light = @first(light[salon])')
      const context1 = await ctx()
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context1,
      )

      expect(result1.status).toBe('success')
      expect(result1.session.variableModifiers['my_light']).toBe('@first')

      const program2 = parse('$my_light.power = off')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context1.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      const exec = result2.executed[result2.executed.length - 1]!
      expect(exec.resolvedDevices).toHaveLength(1)
      expect(exec.resolvedDevices[0]!.type).toBe('light')
    })

    it('should resolve @oneof with a single matching device', async () => {
      const program = parse(`$tv = @oneof(tv[salon])\n$tv.power = on`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)

      const varExec = result.executed[0]!
      expect(varExec.resolvedDevices).toHaveLength(1)
      expect(varExec.resolvedDevices[0]!.id).toBe('tv_salon')
      expect(result.session.variableModifiers['tv']).toBe('@oneof')
      expect(result.session.variableResolvedIds['tv']).toBe('tv_salon')

      const assignExec = result.executed[1]!
      expect(assignExec.resolvedDevices).toHaveLength(1)
      expect(assignExec.resolvedDevices[0]!.id).toBe('tv_salon')

      const pwr = await getProperty(assignExec.resolvedDevices[0]!, 'power')
      expect(pwr).toBe(true)
    })

    it('should trigger ambiguity on @oneof with multiple devices', async () => {
      const program = parse('$my_light = @oneof(light)')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('awaiting_interaction')
      expect(result.interaction).toBeDefined()

      const sel = result.interaction as DeviceSelectionInteraction
      expect(sel.devices).toHaveLength(2)
      expect(sel.devices[0]!.type).toBe('light')
      const salonDevs = sel.devices.filter(d => d.room === 'salon')
      expect(salonDevs).toHaveLength(2)
    })

    it('should error on @oneof with zero matching devices', async () => {
      const program = parse('$v = @oneof(vacuum[chambre])')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('error')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]!.message).toContain(
        "No device 'vacuum' found in room 'chambre'",
      )
    })

    it('should resolve @oneof across multiple programs after ambiguity resolution', async () => {
      const program1 = parse('$light = @oneof(light)')
      const context1 = await ctx()
      const result1 = await executeCommand(
        { kind: 'run_program', program: program1 },
        context1,
      )

      expect(result1.status).toBe('awaiting_interaction')
      expect(
        (result1.interaction as DeviceSelectionInteraction).devices[0]!.type,
      ).toBe('light')

      resolveDevice(result1.session, 'light_salon_1')
      const program2 = parse('$light = @oneof(light)\n$light.power = off')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program2 },
        { devices: context1.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(result2.session.variableResolvedIds['light']).toBe('light_salon_1')

      const assignExec = result2.executed[result2.executed.length - 1]!
      expect(assignExec.resolvedDevices).toHaveLength(1)
      expect(assignExec.resolvedDevices[0]!.id).toBe('light_salon_1')

      const pwr = await getProperty(assignExec.resolvedDevices[0]!, 'power')
      expect(pwr).toBe(false)
    })

    it('should work with @oneof in @if condition after resolution', async () => {
      const program = parse(
        `$l = @oneof(light)\n@if $l.power? == off\n$l.power = on\n@endif`,
      )
      const context = await ctx()

      // First run: ambiguity on @oneof
      const result1 = await executeCommand(
        { kind: 'run_program', program: program },
        context,
      )
      expect(result1.status).toBe('awaiting_interaction')

      // Resolve to light_salon_2 which has power: true
      resolveDevice(result1.session, 'light_salon_2')
      const result2 = await executeCommand(
        { kind: 'run_program', program: program },
        { devices: context.devices, session: result1.session },
      )

      expect(result2.status).toBe('success')
      // light_salon_2 has power: true, so condition is false and body is not executed
      expect(result2.session.variableResolvedIds['l']).toBe('light_salon_2')
    })

    it('should return error for @oneof in @if when no resolution happened', async () => {
      // Direct device ref in @if with multiple matches — should give the new error message
      const driver = makeDriver()
      const devs: Device[] = [
        await makeDevice('a', 'light', 'salon', 'A', driver, { power: true }),
        await makeDevice('b', 'light', 'salon', 'B', driver, { power: false }),
      ]
      const program = parse(
        '@if light.power? == on\nspeaker.power = on\n@endif',
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        { devices: devs },
      )

      expect(result.status).toBe('error')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]!.message).toContain('@oneof')
      expect(result.errors[0]!.message).toContain(
        'Ambiguous device in @if condition',
      )
    })

    it('should assign tv power and volume in sequence', async () => {
      const program = parse(`tv[salon].power = on\n$it.volume = 20`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)

      const tv = result.executed[0]!.resolvedDevices[0]!
      const pwr = await getProperty(tv, 'power')
      const vol = await getProperty(tv, 'volume')
      expect(pwr).toBe(true)
      expect(vol).toBe(20)
    })

    it("should handle 'turn off all lights'", async () => {
      const program = parse(`light[*].power = off`)
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices).toHaveLength(2)

      for (const d of result.executed[0]!.resolvedDevices) {
        const pwr = await getProperty(d, 'power')
        expect(pwr).toBe(false)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle an empty program', async () => {
      const program = parse('')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(0)
    })

    it('should handle multiple assignments to the same device', async () => {
      const program = parse(
        `tv[salon].power = on\ntv[salon].volume = 50\ntv[salon].power = off`,
      )
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(3)

      const tv = result.executed[0]!.resolvedDevices[0]!
      const pwr = await getProperty(tv, 'power')
      const vol = await getProperty(tv, 'volume')
      expect(pwr).toBe(false)
      expect(vol).toBe(50)
    })

    it('should preserve initial session state when passed', async () => {
      const session = createSession()
      session.variables['foo'] = {
        kind: 'device_ref',
        deviceType: 'tv',
        selectors: [{ kind: 'room', name: 'salon' }],
      }

      const program = parse('light[salon].power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await ctx(session),
      )

      expect(result.session.variables['foo']).toBeDefined()
      expect(result.session.variables['foo']!.deviceType).toBe('tv')
    })
  })

  describe('intent filtering', () => {
    async function filteredDevices(): Promise<Device[]> {
      const driver = makeDriver()
      await driver.init({})

      const tv_mute: Device = {
        id: 'tv_mute',
        type: 'tv',
        room: 'salon',
        name: 'Mute TV',
        driver,
        driverConfig: {
          properties: {
            power: { type: 'boolean' },
            volume: { type: 'number' },
            mute: { type: 'boolean' },
          },
          actions: ['play', 'pause'],
        },
      }

      const tv_basic: Device = {
        id: 'tv_basic',
        type: 'tv',
        room: 'chambre',
        name: 'Basic TV',
        driver,
        driverConfig: {
          properties: {
            power: { type: 'boolean' },
            volume: { type: 'number' },
          },
          actions: ['play', 'pause'],
        },
      }

      return [tv_mute, tv_basic]
    }

    async function filteredCtx(session?: Session): Promise<VMContext> {
      return { devices: await filteredDevices(), session }
    }

    it('should resolve to the only device supporting the property (no ambiguity)', async () => {
      const program = parse('tv.mute = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await filteredCtx(),
      )

      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe('tv_mute')
    })

    it('should still be ambiguous when all devices support the property', async () => {
      const program = parse('tv.power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await filteredCtx(),
      )

      expect(result.status).toBe('awaiting_interaction')
      expect(
        (result.interaction as DeviceSelectionInteraction).devices,
      ).toHaveLength(2)
    })

    it('should resolve to the only device supporting the action (no ambiguity)', async () => {
      const driver = makeDriver()
      await driver.init({})

      const speaker_next: Device = {
        id: 'speaker_next',
        type: 'speaker',
        room: 'salon',
        name: 'Salon Speaker',
        driver,
        driverConfig: {
          properties: {},
          actions: ['play', 'pause', 'next'],
        },
      }

      const speaker_basic: Device = {
        id: 'speaker_basic',
        type: 'speaker',
        room: 'chambre',
        name: 'Chambre Speaker',
        driver,
        driverConfig: {
          properties: {},
          actions: ['play', 'pause'],
        },
      }

      const ctx: VMContext = { devices: [speaker_next, speaker_basic] }
      const program = parse('speaker.next()')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        ctx,
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe('speaker_next')
    })

    it('should filter actions declared as an object (HA style)', async () => {
      const driver = makeDriver()
      await driver.init({})

      const speaker_next: Device = {
        id: 'speaker_next',
        type: 'speaker',
        room: 'salon',
        name: 'Salon Speaker',
        driver,
        driverConfig: {
          properties: {},
          actions: { play: {}, pause: {}, next: {} },
        },
      }

      const speaker_basic: Device = {
        id: 'speaker_basic',
        type: 'speaker',
        room: 'chambre',
        name: 'Chambre Speaker',
        driver,
        driverConfig: {
          properties: {},
          actions: { play: {}, pause: {} },
        },
      }

      const ctx: VMContext = { devices: [speaker_next, speaker_basic] }
      const program = parse('speaker.next()')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        ctx,
      )

      expect(result.status).toBe('success')
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe('speaker_next')
    })

    it('should include filter feedback in executed statement', async () => {
      const program = parse('tv.mute = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await filteredCtx(),
      )

      expect(result.status).toBe('success')
      const stmt = result.executed[0]!
      expect(stmt.filter).toBeDefined()
      expect(stmt.filter!.candidates).toBe(2)
      expect(stmt.filter!.matched).toBe(1)
      expect(stmt.filter!.excluded).toHaveLength(1)

      const excluded: ExcludedDevice = stmt.filter!.excluded[0]!
      expect(excluded.deviceId).toBe('tv_basic')
      expect(excluded.deviceName).toBe('Basic TV')
      expect(excluded.reason).toBe('property_not_supported')
      expect(excluded.details).toContain("does not support property 'mute'")
    })

    it('should include filter feedback when all candidates match', async () => {
      const program = parse('tv.power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await filteredCtx(),
      )

      expect(result.status).toBe('awaiting_interaction')
    })

    it('should include filter feedback on error when no device supports the intent', async () => {
      const driver = makeDriver()
      await driver.init({})

      const light: Device = {
        id: 'light_1',
        type: 'light',
        room: 'salon',
        name: 'Salon Light',
        driver,
        driverConfig: {
          properties: {
            power: { type: 'boolean' },
            brightness: { type: 'number' },
          },
          actions: [],
        },
      }

      const ctx: VMContext = { devices: [light] }
      const program = parse('light.volume = 50')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        ctx,
      )

      expect(result.status).toBe('error')
      expect(result.errors[0]!.message).toContain(
        "does not support property 'volume'",
      )
    })

    it('should pass devices through when no capabilities are declared in driverConfig', async () => {
      const driver = makeDriver()
      await driver.init({})

      const tv1: Device = {
        id: 'tv_1',
        type: 'tv',
        room: 'salon',
        name: 'Salon TV',
        driver,
        driverConfig: {},
      }
      const tv2: Device = {
        id: 'tv_2',
        type: 'tv',
        room: 'chambre',
        name: 'Chambre TV',
        driver,
        driverConfig: {},
      }

      const ctx: VMContext = { devices: [tv1, tv2] }
      const program = parse('tv.power = on')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        ctx,
      )

      expect(result.status).toBe('awaiting_interaction')
      expect(
        (result.interaction as DeviceSelectionInteraction).devices,
      ).toHaveLength(2)
    })

    it('should not set filter on executed statement when no intent is used', async () => {
      const program = parse('$salon_tv = tv[salon]')
      const result = await executeCommand(
        { kind: 'run_program', program: program },
        await filteredCtx(),
      )

      expect(result.status).toBe('success')
      const stmt = result.executed[0]!
      expect(stmt.filter).toBeUndefined()
    })
  })

  describe('validateProgram', () => {
    it('should return no errors for a valid program', async () => {
      const program = parse('tv[salon].power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should error when device type does not exist', async () => {
      const program = parse('camera[salon].snapshot()')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain("No device of type 'camera' found")
    })

    it('should error when device type exists but not in the specified room', async () => {
      const program = parse('tv[cuisine].power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain(
        "No device 'tv' found in room 'cuisine'",
      )
    })

    it('should collect multiple errors across statements', async () => {
      const program = parse(
        'camera[salon].snapshot()\ntv[cuisine].power = on\nlight[inconnue].power = off',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(3)
      expect(errors[0]!.message).toContain('camera')
      expect(errors[1]!.message).toContain('cuisine')
      expect(errors[2]!.message).toContain('inconnue')
    })

    it('should error when variable is not defined', async () => {
      const program = parse('$foo.power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain("Variable '$foo' is not defined")
    })

    it('should error when $it is used with no previous device', async () => {
      const program = parse('$it.power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain('$it is not set')
    })

    it('should not error on ambiguous (no room) statements', async () => {
      const program = parse('tv.power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should not error on wildcard room selectors', async () => {
      const program = parse('tv[*].power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should validate variable assignment with device_ref', async () => {
      const program = parse('$salon_tv = tv[salon]')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should error on variable assignment to non-existent type', async () => {
      const program = parse('$cam = camera')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain("No device of type 'camera' found")
    })

    it('should validate usage of previously defined variable', async () => {
      const program = parse('$salon_tv = tv[salon]\n$salon_tv.power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should error when variable references a type with no matching room', async () => {
      const program = parse('$tv = tv[cuisine]\n$tv.power = on')
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain('cuisine')
    })

    it('should validate @oneof variable without flagging ambiguity', async () => {
      const program = parse(
        '$lights = @oneof(light[salon])\n$lights.power = on',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should validate @if with unambiguous condition (room specified)', async () => {
      const program = parse(
        '@if tv[salon].power? == on\ntv[salon].volume = 50\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should error on @if with ambiguous condition (no room)', async () => {
      const program = parse(
        '@if light.power? == on\nspeaker[salon].power = on\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain('Ambiguous device in @if condition')
    })

    it('should skip ambiguity check for @oneof variable in @if condition', async () => {
      // @oneof resolves via interaction at runtime; validation should not flag it
      const program = parse(
        '$l = @oneof(light)\n@if $l.power? == off\n$l.power = on\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should error on non-@oneof variable in @if when ambiguous', async () => {
      // Plain variable reference without room — should be flagged as ambiguous
      const program = parse(
        '$l = light\n@if $l.power? == off\n$l.power = on\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain('Ambiguous device in @if condition')
    })

    it('should validate both branches of @if/@else', async () => {
      const program = parse(
        '@if tv[salon].power? == on\ncamera[salon].snapshot()\n@else\ntv[cuisine].power = on\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(2)
      expect(errors[0]!.message).toContain('camera')
      expect(errors[1]!.message).toContain('cuisine')
    })

    it('should handle nested @if blocks', async () => {
      const driver = makeDriver()
      const { validateProgram } = await import('./index.js')
      const dev: Device = {
        id: 'tv_1',
        type: 'tv',
        room: 'salon',
        name: 'Salon TV',
        driver,
        driverConfig: {},
      }
      const program = parse(
        '@if tv[salon].power? == on\ntv[salon].volume = 50\n@endif',
      )
      const errors = validateProgram(program, [dev])
      expect(errors).toHaveLength(0)
    })

    it('should error on assignment to non-existent room in nested @if', async () => {
      const program = parse(
        '@if tv[salon].power? == on\ntv[cuisine].power = on\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain('cuisine')
    })

    it('should error on $it not set in @if condition', async () => {
      const program = parse(
        '@if $it.power? == on\ntv[salon].power = on\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain('$it is not set')
    })

    it('should track $it from @if condition for body validation', async () => {
      // thermostat has a single instance — unambiguous in @if condition
      const program = parse(
        '@if thermostat[salon].temperature? == 21\n$it.temperature = 22\n@endif',
      )
      const { validateProgram } = await import('./index.js')
      const devs = await devices()
      const errors = validateProgram(program, devs)
      expect(errors).toHaveLength(0)
    })

    it('should use existing session variables for validation', async () => {
      const program = parse('$salon_tv.power = on')
      const { validateProgram, createSession } = await import('./index.js')
      const session = createSession()
      session.variables['salon_tv'] = {
        kind: 'device_ref',
        deviceType: 'tv',
        selectors: [{ kind: 'room', name: 'salon' }],
      }
      const devs = await devices()
      const errors = validateProgram(program, devs, session)
      expect(errors).toHaveLength(0)
    })

    it('should error when existing session variable references non-existent type', async () => {
      const program = parse('$cam_v.power = on')
      const { validateProgram, createSession } = await import('./index.js')
      const session = createSession()
      session.variables['cam_v'] = {
        kind: 'device_ref',
        deviceType: 'camera',
        selectors: [],
      }
      const devs = await devices()
      const errors = validateProgram(program, devs, session)
      expect(errors).toHaveLength(1)
      expect(errors[0]!.message).toContain('camera')
    })
  })

  describe('owner selectors', () => {
    it('should resolve device by owner', async () => {
      const program = parse('light[owner:Alice].power = on')
      const devs = await devices([
        {
          id: 'light_alice',
          type: 'light',
          room: 'salon',
          name: "Alice's Light",
          initialState: { power: false },
        },
        {
          id: 'light_bob',
          type: 'light',
          room: 'salon',
          name: "Bob's Light",
          initialState: { power: false },
        },
      ])
      devs[0]!.owners = ['Alice']
      devs[1]!.owners = ['Bob']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe('light_alice')
      expect(await getProperty(devs[0]!, 'power')).toBe(true)
      expect(await getProperty(devs[1]!, 'power')).toBe(false)
    })

    it('should resolve device by room + owner chain', async () => {
      const program = parse('light[salon][owner:Alice].power = on')
      const devs = await devices([
        {
          id: 'light_salon_alice',
          type: 'light',
          room: 'salon',
          name: 'Alice Salon',
          initialState: { power: false },
        },
        {
          id: 'light_salon_bob',
          type: 'light',
          room: 'salon',
          name: 'Bob Salon',
          initialState: { power: false },
        },
        {
          id: 'light_chambre_alice',
          type: 'light',
          room: 'chambre',
          name: 'Alice Chambre',
          initialState: { power: false },
        },
      ])
      devs[0]!.owners = ['Alice']
      devs[1]!.owners = ['Bob']
      devs[2]!.owners = ['Alice']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('success')
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe(
        'light_salon_alice',
      )
    })

    it('should resolve multi-owner device', async () => {
      const program = parse('light[owner:Alice].power = on')
      const devs = await devices([
        {
          id: 'light_shared',
          type: 'light',
          room: 'salon',
          name: 'Shared Light',
          initialState: { power: false },
        },
      ])
      devs[0]!.owners = ['Alice', 'Bob']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('success')
      expect(result.executed[0]!.resolvedDevices).toHaveLength(1)
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe('light_shared')
    })

    it('should resolve @all with owner', async () => {
      const program = parse(
        '$alice = @all(light[owner:Alice])\n$alice.power = on',
      )
      const devs = await devices([
        {
          id: 'light_alice_1',
          type: 'light',
          room: 'salon',
          name: 'Alice 1',
          initialState: { power: false },
        },
        {
          id: 'light_alice_2',
          type: 'light',
          room: 'chambre',
          name: 'Alice 2',
          initialState: { power: false },
        },
        {
          id: 'light_bob',
          type: 'light',
          room: 'salon',
          name: 'Bob',
          initialState: { power: false },
        },
      ])
      devs[0]!.owners = ['Alice']
      devs[1]!.owners = ['Alice']
      devs[2]!.owners = ['Bob']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('success')
      expect(result.executed).toHaveLength(2)
      expect(await getProperty(devs[0]!, 'power')).toBe(true)
      expect(await getProperty(devs[1]!, 'power')).toBe(true)
      expect(await getProperty(devs[2]!, 'power')).toBe(false)
    })

    it('should return empty when owner does not match', async () => {
      const program = parse('light[owner:Unknown].power = on')
      const devs = await devices([
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Light 1',
          initialState: {},
        },
      ])
      devs[0]!.owners = ['Alice']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('error')
      expect(result.errors[0]!.message).toBe(
        "No 'light' devices with owner 'Unknown'",
      )
    })

    it('should return empty when room+owner does not match', async () => {
      const program = parse('light[salon][owner:Bob].power = on')
      const devs = await devices([
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Light 1',
          initialState: {},
        },
      ])
      devs[0]!.owners = ['Alice']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('error')
      expect(result.errors[0]!.message).toBe(
        "No 'light' devices in room 'salon' with owner 'Bob'",
      )
    })
  })

  describe('tag selectors', () => {
    it('should resolve device by tag', async () => {
      const program = parse('light[tag:main].power = on')
      const devs = await devices([
        {
          id: 'light_main',
          type: 'light',
          room: 'salon',
          name: 'Main Light',
          initialState: { power: false },
        },
        {
          id: 'light_aux',
          type: 'light',
          room: 'salon',
          name: 'Aux Light',
          initialState: { power: false },
        },
      ])
      devs[0]!.tags = ['main']
      devs[1]!.tags = ['secondary']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('success')
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe('light_main')
      expect(await getProperty(devs[0]!, 'power')).toBe(true)
      expect(await getProperty(devs[1]!, 'power')).toBe(false)
    })

    it('should resolve device by room + tag chain', async () => {
      const program = parse('light[salon][tag:audio].power = on')
      const devs = await devices([
        {
          id: 'light_salon_audio',
          type: 'light',
          room: 'salon',
          name: 'Salon Audio',
          initialState: { power: false },
        },
        {
          id: 'light_salon_other',
          type: 'light',
          room: 'salon',
          name: 'Salon Other',
          initialState: { power: false },
        },
        {
          id: 'light_chambre_audio',
          type: 'light',
          room: 'chambre',
          name: 'Chambre Audio',
          initialState: { power: false },
        },
      ])
      devs[0]!.tags = ['audio']
      devs[1]!.tags = ['video']
      devs[2]!.tags = ['audio']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('success')
      expect(result.executed[0]!.resolvedDevices[0]!.id).toBe(
        'light_salon_audio',
      )
    })

    it('should resolve @all with tag', async () => {
      const program = parse(
        '$audio = @all(light[tag:audio])\n$audio.power = on',
      )
      const devs = await devices([
        {
          id: 'light_audio_1',
          type: 'light',
          room: 'salon',
          name: 'Audio 1',
          initialState: { power: false },
        },
        {
          id: 'light_audio_2',
          type: 'light',
          room: 'chambre',
          name: 'Audio 2',
          initialState: { power: false },
        },
        {
          id: 'light_video',
          type: 'light',
          room: 'salon',
          name: 'Video',
          initialState: { power: false },
        },
      ])
      devs[0]!.tags = ['audio']
      devs[1]!.tags = ['audio']
      devs[2]!.tags = ['video']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('success')
      expect(await getProperty(devs[0]!, 'power')).toBe(true)
      expect(await getProperty(devs[1]!, 'power')).toBe(true)
      expect(await getProperty(devs[2]!, 'power')).toBe(false)
    })

    it('should return detailed error when tag does not match', async () => {
      const program = parse('light[tag:outdoor].power = on')
      const devs = await devices([
        {
          id: 'light_1',
          type: 'light',
          room: 'salon',
          name: 'Light 1',
          initialState: {},
        },
      ])
      devs[0]!.tags = ['indoor']
      const c = { devices: devs }
      const result = await executeCommand({ kind: 'run_program', program }, c)
      expect(result.status).toBe('error')
      expect(result.errors[0]!.message).toBe(
        "No 'light' devices with tag 'outdoor'",
      )
    })
  })

  describe('action arguments', () => {
    async function actionDevice(
      id: string,
      type: string,
      room: string,
      name: string,
      actions: Record<string, unknown>,
    ): Promise<Device> {
      const driver = makeDriver()
      await driver.init({})
      return {
        id,
        type,
        room,
        name,
        driver,
        driverConfig: { actions },
      }
    }

    function speakerWithAnnounce(): Promise<Device> {
      return actionDevice(
        'speaker_salon',
        'speaker',
        'salon',
        'Salon Speaker',
        {
          announce: {
            parameters: [
              { name: 'message', type: 'string', required: true },
              { name: 'volume', type: 'number' },
            ],
          },
        },
      )
    }

    it('should pass inline named args to the driver', async () => {
      const dev = await speakerWithAnnounce()
      const spy = vi.spyOn(dev.driver, 'executeAction')
      const program = parse(
        'speaker[salon].announce(message="bonjour", volume=80)',
      )
      const result = await executeCommand(
        { kind: 'run_program', program },
        { devices: [dev] },
      )

      expect(result.status).toBe('success')
      expect(spy).toHaveBeenCalledWith(
        'speaker_salon',
        'announce',
        { message: 'bonjour', volume: 80 },
        expect.anything(),
      )
    })

    it('should pass whole-bundle args to the driver', async () => {
      const dev = await speakerWithAnnounce()
      const spy = vi.spyOn(dev.driver, 'executeAction')
      const program = parse(
        '?args = { message="bonjour", volume=80 }\nspeaker[salon].announce(?args)',
      )
      const result = await executeCommand(
        { kind: 'run_program', program },
        { devices: [dev] },
      )

      expect(result.status).toBe('success')
      expect(spy).toHaveBeenCalledWith(
        'speaker_salon',
        'announce',
        { message: 'bonjour', volume: 80 },
        expect.anything(),
      )
    })

    it('should pause for missing required arg', async () => {
      const dev = await speakerWithAnnounce()
      const program = parse('speaker[salon].announce()')
      const result = await executeCommand(
        { kind: 'run_program', program },
        { devices: [dev] },
      )

      expect(result.status).toBe('awaiting_interaction')
      expect(result.interaction!.type).toBe('action_parameter')
      const interaction = result.interaction as ActionParameterInteraction
      expect(interaction.missing).toEqual([{ name: 'message', type: 'string' }])
    })

    it('should resume and execute with filled inline args', async () => {
      const dev = await speakerWithAnnounce()
      const spy = vi.spyOn(dev.driver, 'executeAction')
      const program = parse('speaker[salon].announce()')
      const result1 = await executeCommand(
        { kind: 'run_program', program },
        { devices: [dev] },
      )
      expect(result1.status).toBe('awaiting_interaction')

      const result2 = await executeCommand(
        {
          kind: 'resume_interaction',
          response: {
            interactionId: result1.session.pendingInteraction!.id,
            type: 'action_parameter',
            values: { message: 'bonjour' },
          },
        },
        { devices: [dev], session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(spy).toHaveBeenCalledWith(
        'speaker_salon',
        'announce',
        { message: 'bonjour' },
        expect.anything(),
      )
    })

    it('should fill missing args into the bundle on resume', async () => {
      const dev = await speakerWithAnnounce()
      const spy = vi.spyOn(dev.driver, 'executeAction')
      const program = parse(
        '?args = { volume=80 }\nspeaker[salon].announce(?args)',
      )
      const result1 = await executeCommand(
        { kind: 'run_program', program },
        { devices: [dev] },
      )
      expect(result1.status).toBe('awaiting_interaction')

      const result2 = await executeCommand(
        {
          kind: 'resume_interaction',
          response: {
            interactionId: result1.session.pendingInteraction!.id,
            type: 'action_parameter',
            values: { message: 'bonjour' },
          },
        },
        { devices: [dev], session: result1.session },
      )

      expect(result2.status).toBe('success')
      expect(spy).toHaveBeenCalledWith(
        'speaker_salon',
        'announce',
        { message: 'bonjour', volume: 80 },
        expect.anything(),
      )
      expect(result2.session.argVariables['args']).toEqual({
        volume: { kind: 'number', value: 80 },
        message: { kind: 'string', value: 'bonjour' },
      })
    })

    it('should persist bundles across statements', async () => {
      const dev = await speakerWithAnnounce()
      const program = parse(
        '?args = { message="bonjour" }\nspeaker[salon].announce(?args)',
      )
      const result = await executeCommand(
        { kind: 'run_program', program },
        { devices: [dev] },
      )

      expect(result.status).toBe('success')
      expect(result.session.argVariables['args']).toEqual({
        message: { kind: 'string', value: 'bonjour' },
      })
    })

    it('should execute action with no required params without pausing', async () => {
      const dev = await actionDevice(
        'vacuum_salon',
        'vacuum',
        'salon',
        'Salon Vacuum',
        {
          start: {
            parameters: [
              { name: 'mode', type: 'enum', values: ['silent', 'normal'] },
            ],
          },
        },
      )
      const program = parse('vacuum[salon].start()')
      const result = await executeCommand(
        { kind: 'run_program', program },
        { devices: [dev] },
      )

      expect(result.status).toBe('success')
    })
  })
})
