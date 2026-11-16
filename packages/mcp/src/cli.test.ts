import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  toDeviceEntries,
  CliConfigError,
  resolveConfig,
  runCli,
} from './cli.js'

describe('resolveConfig', () => {
  it('applies defaults', () => {
    expect(resolveConfig({})).toEqual({
      yamlPath: 'opennest.yaml',
      maxFailedResumes: 2,
    })
  })

  it('reads values from env', () => {
    expect(
      resolveConfig({
        OPENNEST_YAML: 'inv.yaml',
        OPENNEST_MAX_FAILED_RESUMES: '5',
      }),
    ).toEqual({ yamlPath: 'inv.yaml', maxFailedResumes: 5 })
  })

  it.each(['abc', '0', '-1', '1.5', ''])(
    'rejects invalid OPENNEST_MAX_FAILED_RESUMES %j',
    value => {
      expect(() =>
        resolveConfig({ OPENNEST_MAX_FAILED_RESUMES: value }),
      ).toThrow(CliConfigError)
    },
  )
})

describe('runCli', () => {
  it('rejects with CliConfigError naming the path when the YAML is missing', async () => {
    const path = '/does/not/exist.yaml'
    const error = await runCli({ OPENNEST_YAML: path }).catch(e => e)
    expect(error).toBeInstanceOf(CliConfigError)
    expect((error as Error).message).toContain(path)
  })

  it('rejects with CliConfigError naming the path when the YAML is malformed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opennest-mcp-'))
    const path = join(dir, 'bad.yaml')
    writeFileSync(
      path,
      'drivers: {unknown_driver: {}}\ndevices: []\nrooms: []\n',
    )
    const error = await runCli({ OPENNEST_YAML: path }).catch(e => e)
    expect(error).toBeInstanceOf(CliConfigError)
    expect((error as Error).message).toContain(path)
  })
})

describe('toDeviceEntries', () => {
  it('extracts capabilities from driverConfig (record and list forms)', () => {
    const entries = toDeviceEntries([
      {
        id: 'tv_1',
        type: 'tv',
        room: 'salon',
        name: 'TV',
        driver: {} as never,
        driverConfig: {
          properties: {
            power: { type: 'boolean' },
            volume: { type: 'number' },
          },
          actions: ['play', 'pause'],
        },
        tags: ['media'],
      },
      {
        id: 'l_1',
        type: 'light',
        room: 'salon',
        name: 'Light',
        driver: {} as never,
        driverConfig: { properties: {}, actions: { dim: {} } },
      },
      {
        id: 'x',
        type: 'x',
        room: 'r',
        name: 'X',
        driver: {} as never,
        driverConfig: {},
      },
    ])
    expect(entries[0]).toEqual({
      id: 'tv_1',
      type: 'tv',
      room: 'salon',
      name: 'TV',
      tags: ['media'],
      capabilities: {
        properties: ['power', 'volume'],
        actions: ['play', 'pause'],
      },
    })
    expect(entries[1]?.capabilities).toEqual({
      properties: [],
      actions: ['dim'],
    })
    expect(entries[2]).not.toHaveProperty('capabilities')
  })
})
