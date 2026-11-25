import { MockDriver } from '@opennest/devices/dist/drivers/mock.js'
import type { Device } from '@opennest/sdk'

export interface PlaygroundFixture {
  driver: MockDriver
  devices: Device[]
}

export function createPlaygroundDevices(): PlaygroundFixture {
  const driver = new MockDriver()

  const specs = [
    {
      id: 'tv_living_room',
      type: 'tv',
      room: 'living_room',
      name: 'Living Room TV',
      initialState: { power: false, volume: 15, source: 'hdmi1', channel: 1 },
    },
    {
      id: 'tv_living_room_2',
      type: 'tv',
      room: 'living_room',
      name: 'Living Room TV 2',
      initialState: {
        power: false,
        volume: 20,
        source: 'netflix',
        channel: 42,
      },
    },
    {
      id: 'tv_bedroom',
      type: 'tv',
      room: 'bedroom',
      name: 'Bedroom TV',
      initialState: { power: false, volume: 10, source: 'tv', channel: 7 },
    },
    {
      id: 'light_living_room_1',
      type: 'light',
      room: 'living_room',
      name: 'Living Room Ceiling Light',
      initialState: {
        power: false,
        brightness: 80,
        color: 'warm_white',
        mode: 'normal',
      },
    },
    {
      id: 'light_living_room_2',
      type: 'light',
      room: 'living_room',
      name: 'Living Room Lamp',
      initialState: {
        power: true,
        brightness: 40,
        color: 'yellow',
        mode: 'reading',
      },
    },
    {
      id: 'light_bedroom',
      type: 'light',
      room: 'bedroom',
      name: 'Bedroom Ceiling Light',
      initialState: {
        power: false,
        brightness: 100,
        color: 'white',
        mode: 'normal',
      },
    },
    {
      id: 'thermostat_living_room',
      type: 'thermostat',
      room: 'living_room',
      name: 'Thermostat Living Room',
      initialState: { temperature: 21 },
    },
    {
      id: 'speaker_living_room',
      type: 'speaker',
      room: 'living_room',
      name: 'Living Room Speaker',
      initialState: { power: false, volume: 30 },
    },
    {
      id: 'speaker_bedroom',
      type: 'speaker',
      room: 'bedroom',
      name: 'Bedroom Speaker',
      initialState: { power: false, volume: 20 },
    },
    {
      id: 'vacuum_living_room',
      type: 'vacuum',
      room: 'living_room',
      name: 'Living Room Vacuum',
      initialState: {},
    },
    {
      id: 'camera_entrance',
      type: 'camera',
      room: 'entrance',
      name: 'Entrance Camera',
      initialState: {},
    },
    {
      id: 'door_entrance',
      type: 'door',
      room: 'entrance',
      name: 'Entrance Door',
      initialState: { state: 'unlocked' },
    },
    {
      id: 'fan_bedroom',
      type: 'fan',
      room: 'bedroom',
      name: 'Bedroom Fan',
      initialState: { power: false, speed: 1 },
    },
    {
      id: 'switch_entrance',
      type: 'switch',
      room: 'entrance',
      name: 'Entrance Switch',
      initialState: { power: false },
    },
  ]

  for (const spec of specs) {
    driver.seed(spec.id, spec.initialState)
  }

  const devices: Device[] = specs.map(spec => ({
    id: spec.id,
    type: spec.type,
    room: spec.room,
    name: spec.name,
    driver,
    driverConfig: { properties: spec.initialState },
  }))

  return { driver, devices }
}
