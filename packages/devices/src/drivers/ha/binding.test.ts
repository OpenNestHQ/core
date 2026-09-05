import { describe, it, expect } from 'vitest'
import {
  normalizeActionConfig,
  normalizePropertyBinding,
  normalizePropertyConfig,
} from './binding.js'
import type { HARawActionConfig } from './binding.js'

describe('normalizePropertyBinding', () => {
  it('should throw a clear error when raw is a primitive', () => {
    expect(() =>
      normalizePropertyBinding('on' as unknown as { entity: string }),
    ).toThrow(/must be an object/)
  })

  it('should throw a clear error when raw is a number', () => {
    expect(() =>
      normalizePropertyBinding(42 as unknown as { entity: string }),
    ).toThrow(/must be an object/)
  })

  it('should throw a clear error when raw is an array', () => {
    expect(() =>
      normalizePropertyBinding([] as unknown as { entity: string }),
    ).toThrow(/must be an object/)
  })

  it('should throw a clear error when raw is null', () => {
    expect(() =>
      normalizePropertyBinding(null as unknown as { entity: string }),
    ).toThrow(/must be an object/)
  })

  it('should delegate to normalizePropertyConfig for flat configs', () => {
    const binding = normalizePropertyBinding({ entity: 'switch.test' })
    expect(binding.get).toEqual({ kind: 'state' })
    expect(binding.set).toEqual({ kind: 'inferred' })
  })
})

describe('normalizePropertyConfig', () => {
  it('should map entity without attribute to state get strategy', () => {
    const binding = normalizePropertyConfig({ entity: 'switch.salon' })

    expect(binding.get).toEqual({ kind: 'state' })
  })

  it('should map entity with attribute to attribute get strategy', () => {
    const binding = normalizePropertyConfig({
      entity: 'media_player.salon',
      attribute: 'volume_level',
    })

    expect(binding.get).toEqual({
      kind: 'attribute',
      attribute: 'volume_level',
    })
  })

  it('should map config without set_service to inferred set strategy', () => {
    const binding = normalizePropertyConfig({ entity: 'switch.salon' })

    expect(binding.set).toEqual({ kind: 'inferred' })
  })

  it('should map set_service without set_value_key to inferred set strategy', () => {
    const binding = normalizePropertyConfig({
      entity: 'lock.porte',
      set_service: 'lock.{value}',
    })

    expect(binding.set).toEqual({ kind: 'inferred' })
  })

  it('should map set_service with set_value_key to service set strategy', () => {
    const binding = normalizePropertyConfig({
      entity: 'media_player.test',
      set_service: 'media_player.volume_set',
      set_value_key: 'volume_level',
    })

    expect(binding.set).toEqual({
      kind: 'service',
      service: 'media_player.volume_set',
      key: 'volume_level',
    })
  })

  it('should throw on invalid set_service format', () => {
    expect(() =>
      normalizePropertyConfig({
        entity: 'switch.test',
        set_service: 'bad_format_no_dot',
      }),
    ).toThrow(/Invalid service format/)
  })

  it('should throw on invalid set_service format even with set_value_key', () => {
    expect(() =>
      normalizePropertyConfig({
        entity: 'media_player.test',
        set_service: 'bad_format_no_dot',
        set_value_key: 'volume_level',
      }),
    ).toThrow(/Invalid service format/)
  })
})

describe('normalizeActionConfig', () => {
  it('should map plain service action', () => {
    const strategy = normalizeActionConfig({
      service: 'media_player.media_play',
    })

    expect(strategy).toEqual({
      kind: 'service',
      service: 'media_player.media_play',
    })
    expect(strategy).not.toHaveProperty('target')
    expect(strategy).not.toHaveProperty('data')
  })

  it('should map target and data to service action strategy', () => {
    const strategy = normalizeActionConfig({
      service: 'media_player.volume_set',
      target: { entity_id: 'media_player.salon' },
      data: { volume_level: 0.5 },
    })

    expect(strategy).toEqual({
      kind: 'service',
      service: 'media_player.volume_set',
      target: { entity_id: 'media_player.salon' },
      data: { volume_level: 0.5 },
    })
  })

  it('should map a script action to the script strategy', () => {
    const strategy = normalizeActionConfig({
      kind: 'script',
      script: 'script.boost',
      fields: { minutes: '$minutes' },
    } as unknown as HARawActionConfig)

    expect(strategy).toEqual({
      kind: 'script',
      script: 'script.boost',
      fields: { minutes: '$minutes' },
    })
  })

  it('should throw when a script action is missing its script id', () => {
    expect(() =>
      normalizeActionConfig({
        kind: 'script',
        fields: {},
      } as unknown as HARawActionConfig),
    ).toThrow(/strategy "script" requires a "script" id/)
  })
})
