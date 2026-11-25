# @opennest/lang-core

HomeDSL parser, AST types, and LLM prompt generator.

## Install

```bash
pnpm add @opennest/lang-core
```

## API

### `parseHomeDSL(source: string): ParseResult`

Parses a HomeDSL string into a typed AST.

```ts
import { parseHomeDSL } from '@opennest/lang-core'

const result = parseHomeDSL('tv[living_room].power = on')
if (result.errors.length > 0) {
  console.error(result.errors) // { message, line, column }[]
} else {
  // result.program.statements → Statement[]
}
```

### `OpenNestPrompt`

Generates the system prompt for the LLM that compiles natural language into HomeDSL. The constructor takes the device and room definitions (and optionally owners and tags); `prompt()` returns the markdown string.

```ts
import {
  OpenNestPrompt,
  DEFAULT_DEVICES,
  DEFAULT_ROOMS,
  DEFAULT_OWNERS,
  DEFAULT_TAGS,
} from '@opennest/lang-core'

const prompt = new OpenNestPrompt(
  DEFAULT_DEVICES,
  DEFAULT_ROOMS,
  DEFAULT_OWNERS,
  DEFAULT_TAGS,
).prompt({
  preamble: 'You are a HomeDSL translator.',
  customInstruction: 'Output only valid HomeDSL.',
})
```

`PromptOptions` fields (all optional): `preamble`, `examples`, `additionalRules`, `customInstruction`.

[`example-prompt.md`](./example-prompt.md) is the prompt generated from the defaults (`pnpm run build:prompt`). It is the agent-facing HomeDSL reference; it is generated, so do not edit it by hand.

## HomeDSL reference

HomeDSL is line-based: one statement per line, executed top to bottom. The default inventory has **11 device types** (`tv`, `light`, `speaker`, `thermostat`, `fan`, `blind`, `camera`, `vacuum`, `nightstand`, `door`, `switch`); each device can have optional `owners` and `tags`.

### Syntax

The `#` lines below are annotations for this page. They are **not** HomeDSL: the parser has no comment syntax and rejects such lines.

```text
# State assignment
tv.power = on
light.brightness = 50

# Increment
light.brightness += 10

# Queries
tv.power?
thermostat.temperature?

# Actions
vacuum.start()
camera.snapshot()

# Variables ($-prefixed)
$living_tv = tv[living_room]
$living_tv.power = on

# Context reference
$it.volume = 20

# Collections
$lights = @all(light[living_room])
$lights.power = on

# Wildcard rooms (match every room — ambiguous if several devices)
light[*].power = off   # → asks to pick one
$lights = @all(light[*])  # → batch across every room
$lights.power = off

# Owner selectors (who owns the device)
light[owner:Alice].power = on
speaker[owner:Bob].volume = 30

# Tag selectors (category/role of the device)
light[tag:main].power = off
camera[tag:security].snapshot()

# Chained selectors (room + owner + tag — all must match, AND logic)
light[living_room][owner:Alice][tag:main].brightness = 80

# Variables with selectors
$alice_lights = @all(light[owner:Alice])
$alice_lights.power = off

# Conditions
$tv = @oneof(tv)
@if $tv.power? == on
    light.power = off
@else
    light.power = on
@endif

# Compound conditions (& binds tighter than |)
$a = @oneof(tv)
$b = @oneof(thermostat)
$c = @oneof(speaker)
@if $a.power? == on & ($b.temperature? == 25 | $c.power? == on)
    thermostat.temperature = 20
@endif
```

Notes, checked against the parser:

- Values are `on`/`off`, numbers (`-3`, `2.5`), double-quoted strings, or bare identifiers.
- Conditions compare with `==` or `!=`; `@else` is optional; `@if` blocks nest.
- `$it` is reserved: it cannot be assigned, and a bare `it` is not a device type.
- A variable reference cannot take a selector (`$tv[living_room].power` is a parse error).
- Variable assignment needs the `$` prefix (`tv = ...` is rejected).
- Actions take named arguments, `speaker.play(track="x", volume=3)`, or an argument bundle declared with `?name = { track="x" }`, edited with `?name.field = value` and passed as `speaker.play(?name)`.

### Collection modifiers

| Modifier | Behavior |
|---|---|
| `@all(type[room])` | Expands to all matches, batch execution |
| `@first(type[room])` | Selects the first match |
| `@oneof(type[room])` | Resolves immediately to one device, ambiguity if multiple |
| `[*]` | Wildcard room — matches all rooms (still ambiguous if several match) |

### Selectors (room, owner, tag)

Devices can be targeted by three selector types, chainable as `[room][owner:name][tag:name]` (AND logic):

| Selector | Syntax | What it filters |
|---|---|---|
| Room | `type[room_name]` | Physical location (where) |
| Owner | `type[owner:name]` | Person who owns the device (whose) |
| Tag | `type[tag:name]` | Category / feature / role (what) |
| Wildcard | `[*]` | All rooms (match every room, subject to ambiguity) |

Owners and tags are optional fields on each device. If a device has no `owners`/`tags`, it will match only queries without `owner:`/`tag:` selectors.

How the VM resolves these references, asks for disambiguation and validates programs is documented in the [`@opennest/vm` README](../vm/README.md).

## Exports

| Export | Kind | Description |
|---|---|---|
| `parseHomeDSL` | function | HomeDSL → AST parser |
| `ParseError` | class | Parse error with `line` and `column` |
| `OpenNestPrompt` | class | Prompt generator |
| `DEFAULT_DEVICES` | const | 11 device type definitions |
| `DEFAULT_ROOMS` | const | 6 rooms: `living_room`, `bedroom`, `kitchen`, `office`, `bathroom`, `entrance` |
| `DEFAULT_OWNERS` | const | `alice`, `bob`, `kids`, `everybody` |
| `DEFAULT_TAGS` | const | `main`, `audio`, `video`, `security`, `outdoor` |
| `buildProgram`, `buildAction`, `buildAssignment`, `buildQuery`, `buildIncrement` | functions | AST builders |
| `buildRoomSelector`, `buildOwnerSelector`, `buildTagSelector`, `getRoomSelector` | functions | Selector helpers |
| `ParseResult`, `ParseErrorInfo`, `Program`, `Statement`, `Expr`, `Value`, `Selector`, `ConditionExpr`, etc. | types | AST type hierarchy |
| `PromptOptions`, `DeviceDefinition`, `RoomDefinition`, `OwnerDefinition`, `TagDefinition`, `Capability`, etc. | types | Prompt configuration |
| `ActionOutcome`, `Verification`, `VerificationStrategy`, etc. | types | Execution outcome types shared with the VM |
