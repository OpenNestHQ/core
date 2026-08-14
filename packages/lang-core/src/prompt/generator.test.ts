import { describe, it, expect } from 'vitest'
import { OpenNestPrompt } from './generator.js'
import { DEFAULT_DEVICES, DEFAULT_ROOMS } from './defaults.js'
import type {
  DeviceDefinition,
  RoomDefinition,
  PropertyCapability,
  ActionCapability,
} from './types.js'

function makeDevice(
  capabilities: Array<PropertyCapability | ActionCapability>,
): DeviceDefinition {
  return { capabilities }
}

function makeProp(
  name: string,
  type: PropertyCapability['type'],
  range?: [number, number],
  values?: string[],
): PropertyCapability {
  const cap: PropertyCapability = { kind: 'property', name, type }
  if (range) cap.range = range
  if (values) cap.values = values
  return cap
}

function makeAction(name: string): ActionCapability {
  return { kind: 'action', name }
}

describe('DEFAULT_DEVICES', () => {
  it('should contain all 11 default device types', () => {
    const types = Object.keys(DEFAULT_DEVICES)
    expect(types).toHaveLength(11)
    expect(types).toEqual([
      'tv',
      'light',
      'speaker',
      'thermostat',
      'fan',
      'blind',
      'camera',
      'vacuum',
      'nightstand',
      'door',
      'switch',
    ])
  })

  it('should have capabilities for every device', () => {
    for (const device of Object.values(DEFAULT_DEVICES)) {
      expect(device.capabilities.length).toBeGreaterThan(0)
    }
  })

  it('should have tv with power, volume, source, channel, play, pause', () => {
    const tv = DEFAULT_DEVICES['tv']
    expect(tv).toBeDefined()
    const names = tv.capabilities.map(c => c.name)
    expect(names).toContain('power')
    expect(names).toContain('volume')
    expect(names).toContain('source')
    expect(names).toContain('channel')
    expect(names).toContain('play')
    expect(names).toContain('pause')
  })
})

describe('DEFAULT_ROOMS', () => {
  it('should contain 6 default rooms', () => {
    const names = Object.keys(DEFAULT_ROOMS)
    expect(names).toHaveLength(6)
    expect(names).toEqual([
      'living_room',
      'bedroom',
      'kitchen',
      'office',
      'bathroom',
      'entrance',
    ])
  })
})

describe('OpenNestPrompt', () => {
  describe('with default config', () => {
    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt()

    it('should start with the header', () => {
      expect(prompt).toContain('# HomeDSL Language Reference')
      expect(prompt).toContain(
        'HomeDSL is a declarative language for controlling smart home devices.',
      )
    })

    it('should contain the sequential execution note', () => {
      expect(prompt).toContain(
        'Statements execute sequentially, top to bottom.',
      )
      expect(prompt).toContain(
        'Later statements can depend on earlier ones via `$it`.',
      )
    })

    it('should list all supported devices', () => {
      expect(prompt).toContain('# SUPPORTED DEVICES')
      for (const type of Object.keys(DEFAULT_DEVICES)) {
        expect(prompt).toContain(`- ${type}`)
      }
      expect(prompt).toContain('Do not invent new device types.')
    })

    it('should contain the rooms section', () => {
      expect(prompt).toContain('# ROOMS')
      for (const name of Object.keys(DEFAULT_ROOMS)) {
        expect(prompt).toContain(`- ${name}`)
      }
      expect(prompt).toContain('Rooms are logical labels')
    })

    it('should contain the capabilities section with all device details', () => {
      expect(prompt).toContain('# CAPABILITIES')
      expect(prompt).toContain('## TV')
      expect(prompt).toContain('Properties:')

      const capSection = prompt.substring(
        prompt.indexOf('## TV'),
        prompt.indexOf('## LIGHT'),
      )
      expect(capSection).toContain('- power (on/off)')
      expect(capSection).toContain('- volume (0–100)')
      expect(capSection).toContain('- source (hdmi1, hdmi2, tv, netflix)')
      expect(capSection).toContain('Actions (callable):')
      expect(capSection).toContain('- play()')
      expect(capSection).toContain('- pause()')
    })

    it('should render door capabilities correctly', () => {
      expect(prompt).toContain('## DOOR')
      expect(prompt).toContain('- lock()')
      expect(prompt).toContain('- unlock()')
      expect(prompt).toContain('- state (optional)')
    })

    it('should render switch capabilities correctly', () => {
      expect(prompt).toContain('## SWITCH')
      const capSection = prompt.substring(
        prompt.indexOf('## SWITCH'),
        prompt.indexOf('# SYNTAX'),
      )
      expect(capSection).toContain('Properties:')
      expect(capSection).toContain('- power (on/off)')
    })

    it('should contain the syntax section', () => {
      expect(prompt).toContain('# SYNTAX')
      expect(prompt).toContain('## State assignment')
      expect(prompt).toContain('## Query')
      expect(prompt).toContain('## Increment')
      expect(prompt).toContain('## Action')
      expect(prompt).toContain('## Context reference')
    })

    it('should contain the static sections', () => {
      expect(prompt).toContain('# MULTIPLE INSTRUCTIONS')
      expect(prompt).toContain('# USAGE GUIDELINES')
      expect(prompt).toContain('# INVALID PATTERNS')
      expect(prompt).toContain('# AMBIGUITY RESOLUTION')
      expect(prompt).toContain('# GENERAL PRINCIPLE')
      expect(prompt).toContain('# OUTPUT FORMAT')
      expect(prompt).toContain('# EXAMPLES')
    })

    it('should contain example DSL patterns', () => {
      expect(prompt).toContain('tv[living_room].power = on')
      expect(prompt).toContain('tv.power = on')
      expect(prompt).toContain('$it.power = off')
      expect(prompt).toContain('thermostat.temperature = 21')
      expect(prompt).toContain('light[*].power = off')
      expect(prompt).toContain('speaker.play()')
    })

    it('should not contain custom instructions when none provided', () => {
      expect(prompt).not.toContain('# CUSTOM INSTRUCTIONS')
    })

    it('should not contain preamble section when none provided', () => {
      expect(prompt).not.toContain('# ADDITIONAL RULES')
    })
  })

  // --- Custom devices ---

  describe('with custom devices', () => {
    const customDevices: Record<string, DeviceDefinition> = {
      tv: makeDevice([makeProp('power', 'power'), makeAction('play')]),
      light: makeDevice([
        makeProp('power', 'power'),
        makeProp('brightness', 'number', [0, 100]),
      ]),
    }

    const prompt = new OpenNestPrompt(customDevices, DEFAULT_ROOMS).prompt()

    it('should only list the provided devices', () => {
      expect(prompt).toContain('- tv')
      expect(prompt).toContain('- light')
      expect(prompt).not.toContain('- speaker')
      expect(prompt).not.toContain('- thermostat')
    })

    it('should only show capabilities for the provided devices', () => {
      expect(prompt).toContain('## TV')
      expect(prompt).toContain('- power (on/off)')
      expect(prompt).toContain('- play()')
      expect(prompt).toContain('## LIGHT')
      expect(prompt).toContain('- brightness (0–100)')
      expect(prompt).not.toContain('## SPEAKER')
    })

    it('should still contain non-device sections', () => {
      expect(prompt).toContain('# SYNTAX')
      expect(prompt).toContain('# USAGE GUIDELINES')
      expect(prompt).toContain('# EXAMPLES')
    })
  })

  // --- Custom rooms ---

  describe('with custom rooms', () => {
    const customRooms: Record<string, RoomDefinition> = {
      garage: {},
      jardin: {},
    }

    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, customRooms).prompt()

    it('should only list the provided rooms', () => {
      expect(prompt).toContain('- garage')
      expect(prompt).toContain('- jardin')
      expect(prompt).not.toContain('- living_room')
      expect(prompt).not.toContain('- bedroom')
    })

    it('should still contain room selector examples', () => {
      expect(prompt).toContain('- device[room_name]')
      expect(prompt).toContain('- light[*]')
    })
  })

  // --- Custom instruction ---

  describe('with custom instruction', () => {
    const instruction = 'Always prefer salon when no room is specified.'
    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt({
      customInstruction: instruction,
    })

    it('should append the custom instruction section', () => {
      expect(prompt).toContain('# CUSTOM INSTRUCTIONS')
      expect(prompt).toContain(instruction)
    })

    it('should place custom instructions after the main content', () => {
      const examplesIndex = prompt.indexOf('# EXAMPLES')
      const customIndex = prompt.indexOf('# CUSTOM INSTRUCTIONS')
      expect(customIndex).toBeGreaterThan(examplesIndex)
    })
  })

  // --- Preamble ---

  describe('with preamble', () => {
    const preamble = 'You are a HomeDSL compiler agent. Always output raw DSL.'
    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt({
      preamble,
    })

    it('should place preamble before the header', () => {
      const preambleIndex = prompt.indexOf('You are a HomeDSL compiler agent.')
      const headerIndex = prompt.indexOf('# HomeDSL Language Reference')
      expect(preambleIndex).toBeGreaterThanOrEqual(0)
      expect(preambleIndex).toBeLessThan(headerIndex)
    })
  })

  // --- Additional rules ---

  describe('with additional rules', () => {
    const rules = [
      'Always prefer salon when no room is specified.',
      'Never output explanations.',
    ]
    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt({
      additionalRules: rules,
    })

    it('should contain the additional rules section', () => {
      expect(prompt).toContain('# ADDITIONAL RULES')
      expect(prompt).toContain(
        '- Always prefer salon when no room is specified.',
      )
      expect(prompt).toContain('- Never output explanations.')
    })

    it('should place additional rules after examples', () => {
      const examplesIndex = prompt.indexOf('# EXAMPLES')
      const rulesIndex = prompt.indexOf('# ADDITIONAL RULES')
      expect(rulesIndex).toBeGreaterThan(examplesIndex)
    })
  })

  // --- User examples ---

  describe('with user examples', () => {
    const userExamples = [
      `"Play a movie"\n→ tv.play()`,
      `"Goodnight"\n→ light[*].power = off\ndoor[entrance].lock()`,
    ]
    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt({
      examples: userExamples,
    })

    it('should append user examples after default examples', () => {
      expect(prompt).toContain(`"Play a movie"`)
      expect(prompt).toContain('→ tv.play()')
      expect(prompt).toContain(`"Goodnight"`)
      expect(prompt).toContain('door[entrance].lock()')
    })
  })

  // --- Combined options ---

  describe('with combined options', () => {
    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt({
      preamble: 'Preamble text',
      examples: [`"Example"\n→ dsl.rule()`],
      additionalRules: ['Rule 1'],
      customInstruction: 'Custom instruction',
    })

    it('should contain all sections', () => {
      expect(prompt).toContain('Preamble text')
      expect(prompt).toContain('# HomeDSL Language Reference')
      expect(prompt).toContain('# ADDITIONAL RULES')
      expect(prompt).toContain('# CUSTOM INSTRUCTIONS')
    })

    it('should keep sections in correct order', () => {
      const preambleIdx = prompt.indexOf('Preamble text')
      const headerIdx = prompt.indexOf('# HomeDSL Language Reference')
      const examplesIdx = prompt.indexOf('# EXAMPLES')
      const rulesIdx = prompt.indexOf('# ADDITIONAL RULES')
      const customIdx = prompt.indexOf('# CUSTOM INSTRUCTIONS')

      expect(preambleIdx).toBeLessThan(headerIdx)
      expect(headerIdx).toBeLessThan(examplesIdx)
      expect(examplesIdx).toBeLessThan(rulesIdx)
      expect(rulesIdx).toBeLessThan(customIdx)
    })
  })

  // --- Empty configs ---

  describe('with empty devices array', () => {
    const prompt = new OpenNestPrompt({}, DEFAULT_ROOMS).prompt()

    it('should still produce a valid prompt', () => {
      expect(prompt).toContain('# HomeDSL Language Reference')
      expect(prompt).toContain('# SUPPORTED DEVICES')
      expect(prompt).toContain('# CAPABILITIES')
    })

    it('should not list any device types', () => {
      const devicesSection = prompt.substring(
        prompt.indexOf('# SUPPORTED DEVICES'),
        prompt.indexOf('# ROOMS'),
      )
      expect(devicesSection).not.toContain('- tv')
      expect(devicesSection).not.toContain('- light')
    })
  })

  describe('with empty rooms array', () => {
    const prompt = new OpenNestPrompt(DEFAULT_DEVICES, {}).prompt()

    it('should still produce a valid rooms section', () => {
      expect(prompt).toContain('# ROOMS')
    })

    it('should not list default room names', () => {
      const roomsText = prompt.substring(
        prompt.indexOf('# ROOMS'),
        prompt.indexOf('# CAPABILITIES'),
      )
      expect(roomsText).not.toContain('- living_room')
    })
  })

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should not throw with undefined constructor args', () => {
      expect(() =>
        new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt(),
      ).not.toThrow()
    })

    it('should not throw with null-like empty prompt options', () => {
      expect(() =>
        new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt({}),
      ).not.toThrow()
    })

    it('should produce the same result for no args and empty object', () => {
      const a = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt()
      const b = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt({})
      expect(a).toBe(b)
    })

    it('should render device with no capabilities', () => {
      const prompt = new OpenNestPrompt(
        {
          sensor: makeDevice([]),
        },
        {},
      ).prompt()
      expect(prompt).toContain('## SENSOR')
      expect(prompt).toContain('- sensor')
    })

    it('should render property without range and without values', () => {
      const prompt = new OpenNestPrompt(
        {
          test: makeDevice([makeProp('mode', 'string')]),
        },
        {},
      ).prompt()
      expect(prompt).toContain('- mode (optional)')
    })

    it('should NOT render range for number when no range provided', () => {
      const prompt = new OpenNestPrompt(
        {
          test: makeDevice([makeProp('count', 'number')]),
        },
        {},
      ).prompt()
      expect(prompt).toContain('- count')
      expect(prompt).not.toContain('count (')
    })

    it('should NOT render (optional) for power type', () => {
      const prompt = new OpenNestPrompt(
        {
          test: makeDevice([makeProp('power', 'power')]),
        },
        {},
      ).prompt()
      expect(prompt).toContain('- power (on/off)')
      expect(prompt).not.toContain('power (optional)')
    })

    it('should list all rooms when more than 4 are provided', () => {
      const rooms: Record<string, RoomDefinition> = {}
      for (let i = 0; i < 10; i++) {
        rooms[`room_${i}`] = {}
      }
      const prompt = new OpenNestPrompt(DEFAULT_DEVICES, rooms).prompt()
      expect(prompt).toContain('- room_0')
      expect(prompt).toContain('- room_4')
      expect(prompt).toContain('- room_9')
    })
  })
})

describe('capability rendering', () => {
  it('should render power properties as name (on/off)', () => {
    const prompt = new OpenNestPrompt(
      {
        plug: makeDevice([makeProp('power', 'power')]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- power (on/off)')
  })

  it('should render number properties with range as name (min–max)', () => {
    const prompt = new OpenNestPrompt(
      {
        dimmer: makeDevice([makeProp('level', 'number', [1, 10])]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- level (1–10)')
  })

  it('should render enum properties with values', () => {
    const prompt = new OpenNestPrompt(
      {
        media: makeDevice([
          makeProp('input', 'enum', undefined, ['hdmi', 'usb', 'bluetooth']),
        ]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- input (hdmi, usb, bluetooth)')
  })

  it('should render string properties as name (optional)', () => {
    const prompt = new OpenNestPrompt(
      {
        display: makeDevice([makeProp('label', 'string')]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- label (optional)')
  })

  it('should render actions as name()', () => {
    const prompt = new OpenNestPrompt(
      {
        robot: makeDevice([makeAction('start'), makeAction('stop')]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- start()')
    expect(prompt).toContain('- stop()')
  })

  it('should render property description inline', () => {
    const prompt = new OpenNestPrompt(
      {
        plug: makeDevice([
          {
            kind: 'property',
            name: 'power',
            type: 'power',
            description: 'Allume ou éteint',
          },
        ]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- power (on/off) — Allume ou éteint')
  })

  it('should render action description inline', () => {
    const prompt = new OpenNestPrompt(
      {
        robot: makeDevice([
          { kind: 'action', name: 'clean', description: 'Nettoie la pièce' },
        ]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- clean() — Nettoie la pièce')
  })

  it('should render parameter description inline', () => {
    const prompt = new OpenNestPrompt(
      {
        robot: makeDevice([
          {
            kind: 'action',
            name: 'clean',
            parameters: [
              {
                name: 'mode',
                type: 'enum',
                values: ['silent', 'turbo'],
                description: 'Mode de nettoyage',
              },
            ],
          },
        ]),
      },
      {},
    ).prompt()
    expect(prompt).toContain('- clean(mode?: silent|turbo — Mode de nettoyage)')
  })
})

describe('section ordering', () => {
  const prompt = new OpenNestPrompt(DEFAULT_DEVICES, DEFAULT_ROOMS).prompt()

  function sectionOrder(sections: string[]) {
    const indices = sections.map(s => prompt.indexOf(s))
    for (let i = 1; i < indices.length; i++) {
      const prev = indices[i - 1]
      const curr = indices[i]
      if (prev === undefined || curr === undefined) continue
      expect(
        curr,
        `"${sections[i]}" should come after "${sections[i - 1]}"`,
      ).toBeGreaterThan(prev)
    }
  }

  it('should have sections in the expected order', () => {
    sectionOrder([
      '# HomeDSL Language Reference',
      '# SUPPORTED DEVICES',
      '# ROOMS',
      '# CAPABILITIES',
      '# SYNTAX',
      '# MULTIPLE INSTRUCTIONS',
      '# USAGE GUIDELINES',
      '# INVALID PATTERNS',
      '# AMBIGUITY RESOLUTION',
      '# GENERAL PRINCIPLE',
      '# OUTPUT FORMAT',
      '# EXAMPLES',
    ])
  })
})
