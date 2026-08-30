import { describe, it, expect } from 'vitest'
import { validateDeviceBindings } from './validate.js'

function expectValid(config: unknown): void {
  expect(() => validateDeviceBindings('d1', config)).not.toThrow()
}

function expectInvalid(config: unknown, detail: RegExp): void {
  expect(() => validateDeviceBindings('d1', config)).toThrow(detail)
}

describe('validateDeviceBindings — properties', () => {
  it('should accept a full valid new format property set', () => {
    expectValid({
      properties: {
        power: {
          type: 'boolean',
          entity: 'switch.salon',
          get: { kind: 'state' },
          set: { kind: 'inferred' },
        },
        volume: {
          type: 'number',
          entity: 'media_player.salon',
          attribute: 'volume_level',
          set: {
            kind: 'service',
            service: 'media_player.volume_set',
            key: 'volume_level',
          },
        },
        away: {
          set: {
            kind: 'script',
            script: 'script.set_away',
            fields: { mode: '$value' },
          },
        },
      },
    })
  })

  it('should throw on unknown get kind', () => {
    expectInvalid(
      {
        properties: {
          power: { entity: 'switch.salon', get: { kind: 'levitate' } },
        },
      },
      /device "d1", property "power": unknown get kind "levitate" \(expected: state, attribute, template, script, service_response\)/,
    )
  })

  it('should throw on unknown set kind', () => {
    expectInvalid(
      {
        properties: {
          power: { entity: 'switch.salon', set: { kind: 'toggle' } },
        },
      },
      /device "d1", property "power": unknown set kind "toggle" \(expected: inferred, service, script\)/,
    )
  })

  it('should throw when get strategy is not an object', () => {
    expectInvalid(
      { properties: { power: { entity: 'switch.salon', get: 'state' } } },
      /property "power": get strategy must be an object/,
    )
  })

  it('should throw when set strategy is not an object', () => {
    expectInvalid(
      { properties: { power: { entity: 'switch.salon', set: null } } },
      /property "power": set strategy must be an object/,
    )
  })

  it('should throw on attribute get strategy without attribute', () => {
    expectInvalid(
      {
        properties: {
          volume: {
            entity: 'media_player.salon',
            get: { kind: 'attribute' },
          },
        },
      },
      /property "volume": get strategy "attribute" requires a non-empty "attribute"/,
    )
  })

  it('should throw on template get strategy without template', () => {
    expectInvalid(
      {
        properties: {
          status: { entity: 'sensor.salon', get: { kind: 'template' } },
        },
      },
      /property "status": get strategy "template" requires a non-empty "template"/,
    )
  })

  it('should throw on script get strategy with missing script id', () => {
    expectInvalid(
      {
        properties: {
          status: { get: { kind: 'script' } },
        },
      },
      /property "status": get strategy "script" requires a "script" id/,
    )
  })

  it('should throw on script get strategy with malformed script id', () => {
    expectInvalid(
      {
        properties: {
          status: { get: { kind: 'script', script: 'boost' } },
        },
      },
      /property "status": get strategy "script" has an invalid script id "boost" \(expected "script\.<name>"\)/,
    )
  })

  it('should throw on service_response get strategy with malformed service', () => {
    expectInvalid(
      {
        properties: {
          status: {
            get: { kind: 'service_response', service: 'mediaplayerplay' },
          },
        },
      },
      /property "status": get strategy "service_response" has an invalid service format "mediaplayerplay" \(expected "domain.service"\)/,
    )
  })

  it('should throw on set service strategy with malformed service', () => {
    expectInvalid(
      {
        properties: {
          volume: {
            entity: 'media_player.salon',
            set: { kind: 'service', service: 'volume_set' },
          },
        },
      },
      /property "volume": set strategy "service" has an invalid service format "volume_set"/,
    )
  })

  it('should throw on set script strategy with missing script id', () => {
    expectInvalid(
      {
        properties: {
          away: { set: { kind: 'script', fields: { mode: '$value' } } },
        },
      },
      /property "away": set strategy "script" requires a "script" id/,
    )
  })

  it('should throw on orphan $placeholder in set script fields', () => {
    expectInvalid(
      {
        properties: {
          away: {
            set: {
              kind: 'script',
              script: 'script.set_away',
              fields: { mode: '$temp' },
            },
          },
        },
      },
      /property "away": set strategy "script" has an orphan placeholder "\$temp" at fields\.mode \(only "\$value" is available when setting\)/,
    )
  })

  it('should detect orphan placeholders nested in set script fields', () => {
    expectInvalid(
      {
        properties: {
          away: {
            set: {
              kind: 'script',
              script: 'script.set_away',
              fields: { payload: { modes: ['$value', '$nope'] } },
            },
          },
        },
      },
      /orphan placeholder "\$nope" at fields\.payload\.modes\[1\]/,
    )
  })

  it('should throw when set script fields is not an object', () => {
    expectInvalid(
      {
        properties: {
          away: {
            set: { kind: 'script', script: 'script.set_away', fields: 'mode' },
          },
        },
      },
      /property "away": set strategy "script" requires "fields" to be an object/,
    )
  })

  it('should throw on inferred set with declared number type', () => {
    expectInvalid(
      {
        properties: {
          volume: {
            type: 'number',
            entity: 'media_player.salon',
            set: { kind: 'inferred' },
          },
        },
      },
      /property "volume": set strategy "inferred" cannot apply non-boolean values \(declared type "number"\): they would resolve to the invalid service "media_player\.unknown"/,
    )
  })

  it('should throw on inferred set with declared string type', () => {
    expectInvalid(
      {
        properties: {
          source: {
            type: 'string',
            entity: 'media_player.salon',
            set: { kind: 'inferred' },
          },
        },
      },
      /set strategy "inferred" cannot apply non-boolean values/,
    )
  })

  it('should throw on inferred set with declared values and no type', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            values: ['auto', 'heat'],
            entity: 'climate.salon',
            set: { kind: 'inferred' },
          },
        },
      },
      /set strategy "inferred" cannot apply non-boolean values \(declared string values\)/,
    )
  })

  it('should accept inferred set with boolean type', () => {
    expectValid({
      properties: {
        power: {
          type: 'boolean',
          entity: 'switch.salon',
          set: { kind: 'inferred' },
        },
      },
    })
  })

  it('should accept inferred set without declared type or values', () => {
    expectValid({
      properties: {
        power: { entity: 'switch.salon', set: { kind: 'inferred' } },
      },
    })
  })
})

describe('validateDeviceBindings — value maps', () => {
  it('should accept a mapped property with a coherent contract', () => {
    expectValid({
      properties: {
        hvac_mode: {
          type: 'string',
          values: ['auto', 'heat', 'cool', 'off'],
          entity: 'climate.salon',
          map: { cooling: 'cool', heating: 'heat' },
          get: { kind: 'attribute', attribute: 'hvac_action' },
          set: {
            kind: 'service',
            service: 'climate.set_hvac_mode',
            key: 'hvac_mode',
          },
        },
      },
    })
  })

  it('should throw when the declared type is not one of the three', () => {
    expectInvalid(
      {
        properties: {
          power: {
            type: 'bool',
            entity: 'switch.salon',
            get: { kind: 'state' },
          },
        },
      },
      /property "power": type must be "boolean", "number" or "string" \(got "bool"\)/,
    )
  })

  it('should throw when map is not an object', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            entity: 'climate.salon',
            map: 'cooling',
            get: { kind: 'state' },
          },
        },
      },
      /property "hvac_mode": map must be an object mapping HA values to OpenNest values/,
    )
  })

  it('should throw when map_set is not an object', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            entity: 'climate.salon',
            map_set: 42,
            get: { kind: 'state' },
          },
        },
      },
      /property "hvac_mode": map_set must be an object mapping OpenNest values to HA values/,
    )
  })

  it('should throw when a map target is not a scalar', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            entity: 'climate.salon',
            map: { cooling: { mode: 'cool' } },
            get: { kind: 'state' },
          },
        },
      },
      /property "hvac_mode": map\."cooling" must be a string, number or boolean/,
    )
  })

  it('should throw when a map target is not coercible to the declared type', () => {
    expectInvalid(
      {
        properties: {
          level: {
            type: 'number',
            entity: 'sensor.salon',
            map: { low: 'cold' },
            get: { kind: 'state' },
          },
        },
      },
      /property "level": map\."low" target "cold" is not coercible to the declared type "number"/,
    )
  })

  it('should throw when a map target violates the declared values', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            type: 'string',
            values: ['heat', 'cool'],
            entity: 'climate.salon',
            map: { cooling: 'chilly' },
            get: { kind: 'state' },
          },
        },
      },
      /property "hvac_mode": map\."cooling" produces "chilly", which is not one of the declared values "heat", "cool"/,
    )
  })

  it('should throw when a map_set key violates the declared values', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            type: 'string',
            values: ['heat', 'cool'],
            entity: 'climate.salon',
            map: { cooling: 'cool' },
            map_set: { cool: 'cooling', turbo: 'boost' },
            get: { kind: 'state' },
          },
        },
      },
      /property "hvac_mode": map_set key "turbo" is not one of the declared values "heat", "cool"/,
    )
  })

  it('should throw on a non-bijective map with a value-consuming set strategy', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            entity: 'climate.salon',
            map: { cooling: 'cool', freezing: 'cool' },
            get: { kind: 'state' },
            set: {
              kind: 'service',
              service: 'climate.set_hvac_mode',
              key: 'hvac_mode',
            },
          },
        },
      },
      /property "hvac_mode": map is not bijective \("cooling", "freezing" all map to "cool"\): declare an explicit "map_set" for the set direction/,
    )
  })

  it('should judge bijectivity on coerced map targets', () => {
    expectInvalid(
      {
        properties: {
          level: {
            type: 'number',
            entity: 'sensor.salon',
            map: { on: '1', off: '01' },
            get: { kind: 'state' },
            set: {
              kind: 'service',
              service: 'sensor.set_level',
              key: 'level',
            },
          },
        },
      },
      /property "level": map is not bijective \("on", "off" all map to 1\): declare an explicit "map_set" for the set direction/,
    )
  })

  it('should throw on a non-bijective map with a $value set script', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            entity: 'climate.salon',
            map: { cooling: 'cool', freezing: 'cool' },
            get: { kind: 'state' },
            set: {
              kind: 'script',
              script: 'script.set_hvac',
              fields: { mode: '$value' },
            },
          },
        },
      },
      /map is not bijective/,
    )
  })

  it('should accept a non-bijective map when map_set is declared', () => {
    expectValid({
      properties: {
        hvac_mode: {
          entity: 'climate.salon',
          map: { cooling: 'cool', freezing: 'cool' },
          map_set: { cool: 'cooling' },
          get: { kind: 'state' },
          set: {
            kind: 'service',
            service: 'climate.set_hvac_mode',
            key: 'hvac_mode',
          },
        },
      },
    })
  })

  it('should accept a non-bijective map when the set does not consume the value', () => {
    expectValid({
      properties: {
        hvac_mode: {
          entity: 'climate.salon',
          map: { cooling: 'cool', freezing: 'cool' },
          get: { kind: 'state' },
          set: {
            kind: 'service',
            service: 'climate.set_hvac_mode',
          },
        },
      },
    })
    expectValid({
      properties: {
        hvac_mode: {
          entity: 'climate.salon',
          map: { cooling: 'cool', freezing: 'cool' },
          get: { kind: 'state' },
          set: {
            kind: 'script',
            script: 'script.refresh',
            fields: { source: 'declared' },
          },
        },
      },
    })
  })

  it('should keep rejecting inferred sets for non-boolean mapped properties', () => {
    expectInvalid(
      {
        properties: {
          hvac_mode: {
            type: 'string',
            entity: 'climate.salon',
            map: { cooling: 'cool' },
            get: { kind: 'state' },
            set: { kind: 'inferred' },
          },
        },
      },
      /set strategy "inferred" cannot apply non-boolean values \(declared type "string"\)/,
    )
  })
})

describe('validateDeviceBindings — actions', () => {
  it('should accept a valid script action with declared parameters', () => {
    expectValid({
      actions: {
        boost: {
          kind: 'script',
          script: 'script.boost',
          fields: { minutes: '$minutes' },
          parameters: [{ name: 'minutes', type: 'number' }],
        },
      },
    })
  })

  it('should accept a valid service action with target and data', () => {
    expectValid({
      actions: {
        play: {
          kind: 'service',
          service: 'media_player.media_play',
          target: { entity_id: 'media_player.salon' },
        },
      },
    })
  })

  it('should throw on unknown action kind', () => {
    expectInvalid(
      { actions: { boost: { kind: 'zap', script: 'script.boost' } } },
      /device "d1", action "boost": unknown action kind "zap" \(expected: service, script\)/,
    )
  })

  it('should throw on service action with malformed service', () => {
    expectInvalid(
      { actions: { play: { kind: 'service', service: 'play' } } },
      /action "play": action strategy "service" has an invalid service format "play"/,
    )
  })

  it('should throw on service action with missing service', () => {
    expectInvalid(
      { actions: { play: { kind: 'service' } } },
      /action "play": action strategy "service" requires a "service"/,
    )
  })

  it('should throw on script action with malformed script id', () => {
    expectInvalid(
      { actions: { boost: { kind: 'script', script: 'boost' } } },
      /action "boost": action strategy "script" has an invalid script id "boost"/,
    )
  })

  it('should throw on orphan $placeholder referencing an undeclared argument', () => {
    expectInvalid(
      {
        actions: {
          boost: {
            kind: 'script',
            script: 'script.boost',
            fields: { minutes: '$minuts' },
            parameters: [{ name: 'minutes' }],
          },
        },
      },
      /action "boost": action strategy "script" has an orphan placeholder "\$minuts" at fields\.minutes \(declared arguments: minutes\)/,
    )
  })

  it('should throw when parameters are declared empty but placeholders exist', () => {
    expectInvalid(
      {
        actions: {
          boost: {
            kind: 'script',
            script: 'script.boost',
            fields: { minutes: '$minutes' },
            parameters: [],
          },
        },
      },
      /orphan placeholder "\$minutes".*\(declared arguments: none\)/,
    )
  })

  it('should accept placeholders when no parameters are declared', () => {
    expectValid({
      actions: {
        boost: {
          kind: 'script',
          script: 'script.boost',
          fields: { minutes: '$minutes' },
        },
      },
    })
  })
})

describe('validateDeviceBindings — old flat format untouched', () => {
  it('should not validate flat properties, even malformed ones', () => {
    expectValid({
      properties: {
        power: { entity: 'switch.salon' },
        volume: {
          entity: 'media_player.salon',
          set_service: 'media_player.volume_set',
          set_value_key: 'volume_level',
        },
        broken: { entity: 'switch.salon', set_service: 'bad_format_no_dot' },
      },
    })
  })

  it('should not validate flat actions without kind', () => {
    expectValid({
      actions: {
        play: { service: 'media_player.media_play' },
        volume: {
          service: 'media_player.volume_set',
          target: { entity_id: 'media_player.salon' },
          data: { volume_level: 0.5 },
        },
      },
    })
  })

  it('should validate the strategy part of a mixed entry', () => {
    expectInvalid(
      {
        properties: {
          power: { entity: 'switch.salon', get: { kind: 'wat' } },
        },
      },
      /unknown get kind "wat"/,
    )
  })
})

describe('validateDeviceBindings — non-binding shapes', () => {
  it('should accept a config without properties or actions', () => {
    expectValid({ entity: 'switch.salon' })
    expectValid({})
  })

  it('should skip list-shaped properties and actions', () => {
    expectValid({ properties: ['power'], actions: ['play'] })
  })

  it('should accept a non-object config', () => {
    expectValid('nope')
    expectValid(null)
    expectValid(undefined)
  })
})
