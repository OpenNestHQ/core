import type {
  PromptOptions,
  DeviceDefinition,
  RoomDefinition,
  OwnerDefinition,
  TagDefinition,
  Capability,
  PropertyCapability,
  ActionCapability,
  CapabilityParameter,
} from './types.js'
import {
  DEFAULT_DEVICES,
  DEFAULT_ROOMS,
  DEFAULT_OWNERS,
  DEFAULT_TAGS,
} from './defaults.js'

function renderPropertyCapability(cap: PropertyCapability): string {
  const parts: string[] = [cap.name]

  if (cap.type === 'power') {
    parts.push('(on/off)')
  } else if (cap.type === 'number' && cap.range) {
    parts.push(`(${cap.range[0]}–${cap.range[1]})`)
  } else if (cap.type === 'enum' && cap.values) {
    parts.push(`(${cap.values.join(', ')})`)
  } else if (cap.type === 'string') {
    parts.push('(optional)')
  }

  return parts.join(' ')
}

function renderActionCapability(cap: ActionCapability): string {
  const params = cap.parameters?.map(renderParameter).join(', ') ?? ''
  return `${cap.name}(${params})`
}

function renderParameter(p: CapabilityParameter): string {
  const mark = p.required ? '' : '?'
  if (p.type === 'enum' && p.values) {
    return `${p.name}${mark}: ${p.values.join('|')}`
  }
  return `${p.name}${mark}: ${p.type}`
}

function renderCapability(cap: Capability): string {
  if (cap.kind === 'property') {
    return renderPropertyCapability(cap)
  }
  return renderActionCapability(cap)
}

function renderSupportedDevicesSection(
  devices: Record<string, DeviceDefinition>,
): string {
  const lines: string[] = [
    '# SUPPORTED DEVICES',
    '',
    'Supported device types:',
    '',
  ]

  for (const [type, device] of Object.entries(devices)) {
    const desc = device.description ? ` — ${device.description}` : ''
    lines.push(`- ${type}${desc}`)
  }

  lines.push('', 'Do not invent new device types.', '')
  return lines.join('\n')
}

function renderRoomsSection(rooms: Record<string, RoomDefinition>): string {
  const lines: string[] = [
    '# ROOMS',
    '',
    'Rooms are specified using bracket selectors:',
    '',
  ]

  for (const name of Object.keys(rooms)) {
    lines.push(`- ${name}`)
  }

  lines.push('', 'Room selector syntax:', '')
  lines.push('- device[room_name] — targets a specific room')
  lines.push(
    '- light[*] — targets ALL rooms (bypasses ambiguity, batch execution)',
  )

  lines.push(
    '',
    'Rooms are logical labels — they describe where a device is placed.',
    'Devices are matched to rooms at runtime based on the actual inventory.',
    '',
    'The wildcard [*] bypasses ambiguity: light[*].power = off',
    'turns off lights in every room without requiring resolution.',
    '',
    '[*] can be combined with @all: @all(light[*]) stores all lights',
    'from every room in a single variable.',
    '',
  )

  return lines.join('\n')
}

function renderOwnersSection(owners: Record<string, OwnerDefinition>): string {
  if (Object.keys(owners).length === 0) return ''

  const lines: string[] = [
    '# OWNERS',
    '',
    'Owners represent people or roles who control specific devices.',
    'A device can have multiple owners.',
    '',
    'Available owners:',
    '',
  ]

  for (const [, owner] of Object.entries(owners)) {
    const desc = owner.description ? ` — ${owner.description}` : ''
    lines.push(`- ${owner.name}${desc}`)
  }

  lines.push(
    '',
    'Owner selector syntax:',
    '',
    '  device[owner:name] — devices belonging to an owner',
    "  light[owner:Alice] — Alice's lights",
    '',
    'Chaining selectors (room + owner):',
    '',
    "  light[living_room][owner:Alice] — Alice's lights in the living room",
    "  door[owner:enfants].lock() — lock the children's doors",
    '',
    'Collection usage:',
    '',
    '  $alice_lights = @all(light[owner:Alice])',
    '  $alice_lights.power = off',
    '',
    'Heuristics:',
    '',
    '- "my", "Alice\'s", "Bob\'s", "the children\'s" → use [owner:X]',
    '- No owner implied → omit (targets all devices regardless of owner)',
    '- Owner is a device-level concept, independent of room location',
    '',
  )

  return lines.join('\n')
}

function renderTagsSection(tags: Record<string, TagDefinition>): string {
  if (Object.keys(tags).length === 0) return ''

  const lines: string[] = [
    '# TAGS',
    '',
    'Tags are arbitrary category labels attached to devices.',
    'Unlike rooms (WHERE) and owners (WHOSE), tags describe',
    'WHAT a device IS (category, feature, role).',
    '',
    'Available tags:',
    '',
  ]

  for (const [name, tag] of Object.entries(tags)) {
    const desc = tag.description ? ` — ${tag.description}` : ''
    lines.push(`- ${name}${desc}`)
  }

  lines.push(
    '',
    'Tag selector syntax:',
    '',
    '  device[tag:name] — devices with a specific tag',
    '  light[tag:main] — main lights across all rooms',
    '  camera[tag:security].snapshot() — snapshot security cameras',
    '',
    'Chaining selectors (room + owner + tag):',
    '',
    "  light[living_room][owner:Alice][tag:main] — Alice's main salon light",
    '  speaker[tag:audio].volume = 30 — all audio devices volume',
    '',
    'Collection usage:',
    '',
    '  $audio = @all(speaker[tag:audio])',
    '  $audio.volume += 10',
    '',
    'When to use tags vs rooms vs owners:',
    '- Room = WHERE (physical location)',
    '- Owner = WHOSE (person who owns it)',
    '- Tag = WHAT (category, feature, role)',
    '',
  )

  return lines.join('\n')
}

function renderCapabilitiesSection(
  devices: Record<string, DeviceDefinition>,
): string {
  const lines: string[] = [
    '# CAPABILITIES',
    '',
    'Each device supports a subset of capabilities:',
    '',
  ]

  for (const [type, device] of Object.entries(devices)) {
    lines.push(`## ${type.toUpperCase()}`)

    const properties = device.capabilities.filter(c => c.kind === 'property')
    const actions = device.capabilities.filter(c => c.kind === 'action')

    if (properties.length > 0) {
      lines.push('Properties:')
      for (const cap of properties) {
        lines.push(`- ${renderCapability(cap)}`)
      }
    }

    if (actions.length > 0) {
      if (properties.length > 0) lines.push('')
      lines.push('Actions (callable):')
      for (const cap of actions) {
        lines.push(`- ${renderCapability(cap)}`)
      }
    }

    if (type === 'nightstand') {
      lines.push('')
      lines.push(
        'Note: `light.power` is a single property name (not a nested path).',
      )
    }

    lines.push('')
  }

  return lines.join('\n')
}

function renderSyntaxSection(): string {
  return [
    '# SYNTAX',
    '',
    '## State assignment',
    'tv[living_room].power = on',
    '',
    'light[bedroom].brightness = 50',
    '',
    '## Variable assignment',
    '$tv = tv[living_room]',
    '',
    '$lights = @all(light[living_room])',
    '$firstTv = @first(tv) (selects the first matching device)',
    '$tv = @oneof(tv) (resolves immediately, triggers ambiguity if multiple)',
    '',
    '`@all`, `@first`, and `@oneof` are collection modifiers.',
    'They are only valid in variable assignments, never inline in property paths.',
    '',
    '@oneof forces immediate resolution — the variable stores exactly one',
    'device. If multiple devices match, an ambiguity dialog is triggered.',
    'Use @oneof before @if conditions that require a pre-resolved variable.',
    '',
    '## Variable usage',
    '$tv.power = on',
    '',
    '$lights.power = off',
    '',
    'Variables are prefixed with $ (both when defining and using).',
    'A variable stores a device or collection reference for reuse.',
    '',
    'Variable constraints:',
    '- Room selectors on variables are invalid:',
    '  $tv[living_room].power = on → INVALID',
    '- $it is read-only (auto-managed at runtime):',
    '  $it = tv[living_room] → INVALID',
    '- Variables remember their collection modifier.',
    '  $lights = @all(light[living_room]) keeps @all semantics.',
    '- $it is auto-set after every successful device resolution.',
    '  It persists across statements and across calls within a session.',
    '- Using $it as the first statement of a program has no effect —',
    '  it will not be set yet.',
    '',
    '## Owner selector (who owns the device)',
    'light[owner:Alice].power = on',
    '',
    'speaker[living_room][owner:Alice].power = on',
    '',
    '$alice_devices = @all(light[owner:Alice])',
    '',
    'Owner selectors can be chained with room selectors:',
    'device[room][owner:name] — both conditions must match (AND).',
    '',
    '## Query',
    'tv.power?',
    '',
    'thermostat.temperature?',
    '',
    '## Increment',
    'speaker.volume += 10',
    '',
    '## Action',
    'vacuum.start()',
    '',
    'camera.snapshot()',
    '',
    'Actions accept named arguments (name=value) and whole-bundle references:',
    '',
    'speaker.announce(message="bonjour", volume=80)',
    'vacuum.start(mode=silent)',
    '',
    '## Named-argument bundles (?arg)',
    'Arguments can be grouped in a reusable bundle:',
    '',
    '?greeting = { message="bonjour", volume=80 }',
    'speaker.announce(?greeting)',
    '',
    'or built field-by-field:',
    '',
    '?greeting.message = "bonjour"',
    'speaker.announce(?greeting)',
    '',
    'A bundle is referenced whole via `?name` inside the parentheses.',
    'Bundles persist across statements in the session and can be reused.',
    '',
    '## Context reference',
    '$it.power = off',
    '$it.volume = 20',
    '',
    '`$it` refers to the most recently resolved device.',
    '',
  ].join('\n')
}

function renderMultipleInstructionsSection(): string {
  return [
    '# MULTIPLE INSTRUCTIONS',
    '',
    'Each instruction occupies one line.',
    'Later statements can reference earlier results via `$it`.',
    '',
    'Example:',
    'tv.power = on',
    '$it.volume = 20',
    '',
    '`$it` is only available when the previous instruction resolved',
    'successfully without ambiguity. If tv.power = on cannot be resolved',
    '(ambiguous), $it is not set for the next line.',
    '',
  ].join('\n')
}

function renderConditionsSection(): string {
  return [
    '# CONDITIONS',
    '',
    'Conditional blocks allow executing statements only when',
    'a device property matches a specific value.',
    '',
    'Conditions can be combined with `&` (and) and `|` (or).',
    'Parentheses `()` control grouping — `&` binds tighter than `|`.',
    '',
    '## @if / @else / @endif',
    '',
    '$light_salon = light[living_room]',
    '$light_cuisine = @oneof(light[kitchen])',
    '',
    '@if $light_salon.power? == "on"',
    '    $light_cuisine.power = on',
    '    speaker[kitchen].play()',
    '@else',
    '    $light_cuisine.power = off',
    '@endif',
    '',
    'Note: use `@oneof(device[room])` before a condition when the device',
    'type could be ambiguous — even with a room selector, a room may have',
    'multiple devices of the same type.',
    '',
    '## @oneof for condition variables',
    '',
    'Always pre-resolve condition variables with `@oneof`:',
    '',
    '$tv = @oneof(tv[living_room])',
    '@if $tv.power? == "on"',
    '    speaker[living_room].power = on',
    '@endif',
    '',
    'Without @oneof, an ambiguous variable in a condition triggers an error.',
    '@oneof resolves ambiguity by auto-selecting one device when only one',
    'matches, or requesting clarification when multiple match.',
    '',
    '## Syntax',
    '',
    'Simple condition:',
    '@if <path>? == <value>',
    '    <statements>',
    '@else           (optional)',
    '    <statements>',
    '@endif',
    '',
    'With @oneof (recommended):',
    '$var = @oneof(device[room])',
    '@if $var.property? == value',
    '    ...',
    '@endif',
    '',
    'Compound conditions:',
    '@if <cond1> & <cond2>',
    '    ...',
    '',
    '@if <cond1> | <cond2>',
    '    ...',
    '',
    '@if (<cond1> | <cond2>) & <cond3>',
    '    ...',
    '',
    '## Operators',
    '',
    '- `==` — equals',
    '- `!=` — not equals',
    '- `&` — logical AND (higher precedence)',
    '- `|` — logical OR (lower precedence)',
    '- `(...)` — explicit grouping',
    '',
    '## Rules',
    '',
    '- The condition path uses the query syntax (`?`) to read a property value.',
    '- Conditions compare against `on`, `off`, numbers, or quoted strings.',
    '- ALWAYS pre-resolve condition devices with `$var = @oneof(device[room])`',
    '  to avoid ambiguity errors.',
    '- If the device is already unambiguous (exactly one in the room),',
    '  a direct assignment like `$var = device[room]` also works.',
    '- An ambiguous device in a condition triggers an error — ',
    '  the VM cannot guess which device to check.',
    '- Multiple conditions can be combined with `&` and `|`.',
    '- `&` binds tighter than `|` — use `(...)` for explicit grouping.',
    '- `@if` blocks can be nested.',
    '- Empty bodies are valid.',
    '',
  ].join('\n')
}

function renderUsageGuidelinesSection(): string {
  return [
    '# USAGE GUIDELINES',
    '',
    '- Device expressions are always abstract (device type level).',
    '- Do not use device-specific IDs — keep expressions generic.',
    '- If a property or action might not exist for the target device,',
    '  it is still valid DSL — the runtime handles invalid operations.',
    '- Owner selectors let you target devices belonging to a specific person.',
    '  Only use owners listed in the OWNERS section.',
    '',
    'Valid:',
    'tv.power = on',
    '',
    'Invalid:',
    'device(tv_lg_001).power = on',
    '',
  ].join('\n')
}

function renderInvalidPatternsSection(): string {
  return [
    '# INVALID PATTERNS',
    '',
    'The following patterns are not valid HomeDSL:',
    '',
    '$tv[living_room].power = on     — room selector on variable',
    '$it = tv[living_room]             — reassigning read-only $it',
    '$it.power = on              — $it used before being set',
    'tv.brightness = 50          — TV has no brightness property',
    '                              (still valid syntax, runtime handles)',
    '',
  ].join('\n')
}

function renderAmbiguitySection(): string {
  return [
    '# AMBIGUITY RESOLUTION',
    '',
    'When a device expression matches multiple devices, the runtime returns',
    'a waiting state with a candidate list. The caller must pick a device',
    'and re-submit the program.',
    '',
    'Example:',
    '',
    '"Turn on the TV"',
    '→ tv.power = on',
    '',
    'If there are multiple TVs, the runtime returns a waiting state —',
    'the DSL itself does not specify which TV.',
    '',
    'Devices can be pre-resolved before execution:',
    '- session.resolvedIds stores resolved device choices',
    "- Resume by calling executeCommand({ kind: 'resume_interaction', response }, context)",
    '',
  ].join('\n')
}

function renderGeneralPrincipleSection(): string {
  return [
    '# GENERAL PRINCIPLE',
    '',
    'HomeDSL describes intent at the device-type level.',
    'It does not assume which specific devices exist or where they are.',
    '',
    'The runtime handles:',
    '- device selection (matching type + room to inventory)',
    '- room disambiguation',
    '- candidate resolution and filtering',
    '',
  ].join('\n')
}

function renderFormatSection(): string {
  return [
    '# OUTPUT FORMAT',
    '',
    'HomeDSL output consists of raw DSL lines, one per line.',
    'No markdown fences (```), no backticks, no explanatory text.',
    '',
    'If a request cannot be expressed in HomeDSL,',
    'output nothing (empty response).',
    '',
  ].join('\n')
}

function renderExamplesSection(userExamples?: string[]): string {
  const lines: string[] = [
    '# EXAMPLES',
    '',
    '"Turn on the living room TV"',
    '→ tv[living_room].power = on',
    '',
    '"Turn on the TV"',
    '→ tv.power = on',
    '',
    '"Turn it off"',
    '→ $it.power = off',
    '',
    '"Set temperature to 21"',
    '→ thermostat.temperature = 21',
    '',
    '"Turn off all lights"',
    '→ light[*].power = off',
    '',
    '"Play music"',
    '→ speaker.play()',
    '',
    '"Turn on the first TV"',
    '→ $tv = @first(tv)',
    '$tv.power = on',
    '',
    '"Turn off all office lights"',
    '→ $officeLights = @all(light[office])',
    '$officeLights.power = off',
    '',
    '"What\'s the living room temperature?"',
    '→ thermostat[living_room].temperature?',
    '',
    '"Lock the front door"',
    '→ door[entrance].lock()',
    '',
    '"Dim the bedroom light to 20%"',
    '→ light[bedroom].brightness = 20',
    '',
    '"Stop the vacuum and turn on the camera"',
    '→ vacuum.stop()',
    'camera.snapshot()',
    '',
    '"Turn off Alice\'s lights"',
    '→ $alice = @all(light[owner:Alice])',
    '$alice.power = off',
    '',
    '"Dim the children\'s bedroom lights to 20%"',
    '→ light[bedroom][owner:kids].brightness = 20',
    '',
    '"Lock all of Alice\'s doors"',
    '→ door[owner:Alice].lock()',
    '',
    '"Turn off Alice\'s lights"',
    '→ $alice = @all(light[owner:Alice])',
    '$alice.power = off',
    '',
    '"Dim the children\'s bedroom lights to 20%"',
    '→ light[bedroom][owner:kids].brightness = 20',
    '',
    '"Lock all of Alice\'s doors"',
    '→ door[owner:Alice].lock()',
    '',
    '"If the living room light is on, turn on the kitchen light too"',
    '→ $salon = light[living_room]',
    '$cuisine = @oneof(light[kitchen])',
    '@if $salon.power? == "on"',
    '$cuisine.power = on',
    '@endif',
    '',
    '"If the temperature is above 25, turn on the fan, otherwise turn it off"',
    '→ $therm = thermostat[living_room]',
    '$fan = @oneof(fan[living_room])',
    '@if $therm.temperature? == 25',
    '    $fan.power = on',
    '@else',
    '    $fan.power = off',
    '@endif',
    '',
    '"If the living room light AND the TV are both on, turn on the speaker"',
    '→ $salon = light[living_room]',
    '$salon_tv = @oneof(tv[living_room])',
    '@if $salon.power? == on & $salon_tv.power? == on',
    'speaker[living_room].power = on',
    '@endif',
    '',
    '"If the living room light OR the kitchen light is on, close the blinds"',
    '→ $salon = light[living_room]',
    '$cuisine = @oneof(light[kitchen])',
    '@if $salon.power? == on | $cuisine.power? == on',
    'blind[living_room].position = 0',
    '@endif',
    '',
    '"If the TV is off AND (it is hot OR the fan is on), turn on the AC"',
    '→ $tv = @oneof(tv[living_room])',
    '$therm = thermostat[living_room]',
    '$fan = @oneof(fan[living_room])',
    '@if $tv.power? != on & ($therm.temperature? == 25 | $fan.power? == on)',
    'thermostat[living_room].temperature = 20',
    '@endif',
    '',
  ]

  if (userExamples && userExamples.length > 0) {
    for (const example of userExamples) {
      lines.push(example)
      lines.push('')
    }
  }

  return lines.join('\n')
}

function renderHeaderSection(): string {
  return [
    '---',
    '',
    '# HomeDSL Language Reference',
    '',
    'HomeDSL is a declarative language for controlling smart home devices.',
    'HomeDSL programs consist of a sequence of instructions.',
    'Statements execute sequentially, top to bottom.',
    'Later statements can depend on earlier ones via `$it`.',
    '',
  ].join('\n')
}

function renderAdditionalRulesSection(rules: string[]): string {
  const lines: string[] = ['---', '', '# ADDITIONAL RULES', '']

  for (const rule of rules) {
    lines.push(`- ${rule}`)
  }

  lines.push('')
  return lines.join('\n')
}

function renderCustomInstructionSection(instruction: string): string {
  return `\n---\n\n# CUSTOM INSTRUCTIONS\n\n${instruction}\n`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type OpenNestRawPrompt<D extends string, R extends string> = string

export class OpenNestPrompt<D extends string, R extends string> {
  private devices: Record<D, DeviceDefinition>
  private rooms: Record<R, RoomDefinition>
  private owners: Record<string, OwnerDefinition>
  private tags: Record<string, TagDefinition>

  constructor(
    devices: Record<D, DeviceDefinition>,
    rooms: Record<R, RoomDefinition>,
    owners: Record<string, OwnerDefinition> = {},
    tags: Record<string, TagDefinition> = {},
  ) {
    this.devices = devices
    this.rooms = rooms
    this.owners = owners
    this.tags = tags
  }

  prompt(options?: PromptOptions): OpenNestRawPrompt<D, R> {
    const preamble = options?.preamble
    const userExamples = options?.examples
    const additionalRules = options?.additionalRules
    const customInstruction = options?.customInstruction

    const sections: string[] = []

    if (preamble !== undefined) {
      sections.push(`${preamble.trim()}`)
    }

    sections.push(
      renderHeaderSection(),
      '',
      '---',
      '',
      renderSupportedDevicesSection(this.devices),
      renderRoomsSection(this.rooms),
      renderOwnersSection(this.owners),
      renderTagsSection(this.tags),
      renderCapabilitiesSection(this.devices),
      renderSyntaxSection(),
      renderMultipleInstructionsSection(),
      renderConditionsSection(),
      '---',
      '',
      renderUsageGuidelinesSection(),
      '---',
      '',
      renderInvalidPatternsSection(),
      '---',
      '',
      renderAmbiguitySection(),
      '---',
      '',
      renderGeneralPrincipleSection(),
      '---',
      '',
      renderFormatSection(),
      '---',
      '',
      renderExamplesSection(userExamples),
    )

    if (additionalRules && additionalRules.length > 0) {
      sections.push(renderAdditionalRulesSection(additionalRules))
    }

    if (customInstruction !== undefined) {
      sections.push(renderCustomInstructionSection(customInstruction))
    }

    return sections.join('\n')
  }
}

export { DEFAULT_DEVICES, DEFAULT_ROOMS, DEFAULT_OWNERS, DEFAULT_TAGS }
export type {
  PromptOptions,
  DeviceDefinition,
  RoomDefinition,
  OwnerDefinition,
  TagDefinition,
  Capability,
  PropertyCapability,
  ActionCapability,
}
