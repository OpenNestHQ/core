---

# HomeDSL Language Reference

HomeDSL is a declarative language for controlling smart home devices.
HomeDSL programs consist of a sequence of instructions.
Statements execute sequentially, top to bottom.
Later statements can depend on earlier ones via `$it`.


---

# SUPPORTED DEVICES

Supported device types:

- tv — Television set — for watching content, streaming, and multimedia
- light — Ceiling or wall light — main room illumination
- speaker — Music speaker — for audio playback and media control
- thermostat — Room thermostat — controls heating/cooling temperature
- fan — Ventilation fan — for air circulation and cooling
- blind — Motorized blind/shutter — controls window covering position
- camera — Security camera — captures snapshots, no video streaming
- vacuum — Robot vacuum cleaner — autonomous floor cleaning
- nightstand — Bedside nightstand — secondary/ambient light, not main illumination
- door — Smart door — controls lock/unlock state
- switch — Generic on/off switch — for simple power control of any device

Do not invent new device types.

# ROOMS

Rooms are specified using bracket selectors:

- living_room
- bedroom
- kitchen
- office
- bathroom
- entrance

Room selector syntax:

- device[room] — targets a specific room
- light[*] — targets ALL rooms (bypasses ambiguity, batch execution)

Rooms are logical labels — they describe where a device is placed.
Devices are matched to rooms based on the actual inventory.

The wildcard [*] bypasses ambiguity: light[*].power = off
turns off lights in every room without requiring resolution.

[*] can be combined with @all: @all(light[*]) stores all lights
from every room in a single variable.

# OWNERS

Owners represent people or roles who control specific devices.
A device can have multiple owners.

Available owners:

- Alice — Alice's personal devices
- Bob — Bob's personal devices
- Kids — Devices in the children's rooms
- Everybody — Shared family devices (default)

Owner selector syntax:

  device[owner:name] — devices belonging to an owner
  light[owner:Alice] — Alice's lights

Chaining selectors (room + owner):

  light[living_room][owner:Alice] — Alice's lights in the living room
  door[owner:kids].lock() — lock the children's doors

Collection usage:

  $alice_lights = @all(light[owner:Alice])
  $alice_lights.power = off

Heuristics:

- "my", "Alice's", "Bob's", "the children's" → use [owner:name]
- No owner implied → omit (targets all devices regardless of owner)
- Owner is a device-level concept, independent of room location

# TAGS

Tags are arbitrary category labels attached to devices.
Unlike rooms (WHERE) and owners (WHOSE), tags describe
WHAT a device IS (category, feature, role).

Available tags:

- main — Main/default device in a room
- audio — Devices with audio capabilities
- video — Devices with video/display capabilities
- security — Security-related devices
- outdoor — Outdoor devices

Tag selector syntax:

  device[tag:name] — devices with a specific tag
  light[tag:main] — main lights across all rooms
  camera[tag:security].snapshot() — snapshot security cameras

Chaining selectors (room + owner + tag):

  light[living_room][owner:Alice][tag:main] — Alice's main living-room light
  speaker[tag:audio].volume = 30 — all audio devices volume

Collection usage:

  $audio = @all(speaker[tag:audio])
  $audio.volume += 10

When to use tags vs rooms vs owners:
- Room = WHERE (physical location)
- Owner = WHOSE (person who owns it)
- Tag = WHAT (category, feature, role)

# CAPABILITIES

Each device supports a subset of capabilities:

## TV
Properties:
- power (on/off)
- volume (0–100)
- source (hdmi1, hdmi2, tv, netflix)
- channel

Actions (callable):
- play()
- pause()

## LIGHT
Properties:
- power (on/off)
- brightness (0–100)
- color (text)
- mode (text)

## SPEAKER
Properties:
- power (on/off)
- volume (0–100)

Actions (callable):
- play()
- pause()
- next()
- announce(message: string, volume?: number)

## THERMOSTAT
Properties:
- temperature

## FAN
Properties:
- power (on/off)
- speed (0–3)

## BLIND
Properties:
- position (0–100)

## CAMERA
Actions (callable):
- snapshot(count?: number)

## VACUUM
Actions (callable):
- start(room?: living_room|bedroom|kitchen|office|bathroom|entrance, mode?: silent|normal|turbo)
- stop()

## NIGHTSTAND
Properties:
- light.power (on/off)
- brightness (0–100)

Note: `light.power` is a single property name (not a nested path).

## DOOR
Properties:
- state (text)

Actions (callable):
- lock()
- unlock()

## SWITCH
Properties:
- power (on/off)

# TYPES & VALUES

HomeDSL values are written as one of four literals:

## Number
42
3.5
-10

Integer or decimal, optional leading minus sign.

## Power (on/off)
on
off

Bare keywords, lowercase, unquoted. Used for power properties.
There is no true/false — use on/off.

## String
"bonjour"

Double-quoted text. Single quotes are not supported.
Used for string properties (e.g. color, mode) and string action args.

## Identifier (enum)
netflix
silent

A bare word (letters, digits, underscore). Used unquoted for enum values
(e.g. tv.source = netflix) and enum action params (e.g. mode=silent).

## Assigning to properties
- power property  → on | off
- number property → a number (e.g. brightness = 50)
- enum property   → one of its listed values, unquoted (e.g. source = netflix)
- string property → a quoted string (e.g. color = "warm")

## Action arguments
Same value syntax:
speaker.announce(message="bonjour", volume=80)
vacuum.start(mode=silent, room=living_room)

# SYNTAX

## State assignment
tv[living_room].power = on

light[bedroom].brightness = 50

## Variable assignment
$tv = tv[living_room]

A plain reference (no modifier) is lazy: it only records the device type
and selectors. Resolution happens when the variable is used.

## Collection modifiers (@all, @first, @oneof)

$lights = @all(light[living_room])
$firstTv = @first(tv)
$tv = @oneof(tv)

Modifiers are only valid on the right side of a variable assignment,
never inline in a device path.

- @all(...)   — batch. Lazy. On use, selects ALL matching devices and
  applies the operation to each (no ambiguity).
- @first(...) — single. Lazy. On use, selects the FIRST matching device
  (inventory order) and applies the operation to it only (no ambiguity).
  Use it when any single device is acceptable.
- @oneof(...) — pre-resolve. EAGER: resolves at assignment time.

@oneof resolution at assignment:
- exactly one match → the variable is bound to that specific device.
- zero matches → error.
- multiple matches → execution pauses and asks the user to pick one;
  the variable then holds the chosen device.

Use @oneof when the variable must hold a single concrete device before
it is used — e.g. in an @if condition, which cannot be ambiguous.

## Variable usage
$tv.power = on

$lights.power = off

Variables are prefixed with $ (both when defining and using).
A variable stores a device or collection reference for reuse.

Variable constraints:
- Room selectors on variables are invalid:
  $tv[living_room].power = on → INVALID
- $it is read-only (auto-managed):
  $it = tv[living_room] → INVALID
- Variables remember their collection modifier.
  $lights = @all(light[living_room]) keeps @all semantics.
- $it is auto-set after every successful device resolution.
  It persists across statements.

## Owner selector (who owns the device)
light[owner:Alice].power = on

speaker[living_room][owner:Alice].power = on

$alice_devices = @all(light[owner:Alice])

Owner selectors can be chained with room selectors:
device[room][owner:name] — both conditions must match (AND).

## Query
tv.power?

thermostat.temperature?

## Increment
speaker.volume += 10

## Action
vacuum.start()

camera.snapshot()

Actions accept named arguments (name=value) and whole-bundle references:

speaker.announce(message="bonjour", volume=80)
vacuum.start(mode=silent)

## Named-argument bundles (?arg)
Arguments can be grouped in a reusable bundle:

?greeting = { message="bonjour", volume=80 }
speaker.announce(?greeting)

or built field-by-field:

?greeting.message = "bonjour"
speaker.announce(?greeting)

A bundle is referenced whole via `?name` inside the parentheses.
Bundles persist across statements and can be reused.

## Context reference
$it.power = off
$it.volume = 20

`$it` always refers to exactly one device — the most recently resolved one.
It is set after any device statement executes (assignment, query, increment,
action).

`$it` and collections:
- @oneof(device) sets `$it` immediately at assignment (eager).
- @all(...) and @first(...) do NOT set `$it` at assignment — they are lazy.
  `$it` is set only when the variable is actually used.
- With @all, the operation runs on every match, but `$it` still holds a
  single device: the first one in the batch.
- A plain reference ($x = tv[room]) also leaves `$it` unchanged until
  the variable is used.

Using `$it` before any device has been resolved is an error.

# MULTIPLE INSTRUCTIONS

Each instruction occupies one line.
Later statements can reference earlier results via `$it`.

Example:
tv.power = on
$it.volume = 20

`$it` is only available when the previous instruction resolved
successfully without ambiguity. If tv.power = on cannot be resolved
(ambiguous), $it is not set for the next line.

# CONDITIONS

Conditional blocks allow executing statements only when
a device property matches a specific value.

Conditions can be combined with `&` (and) and `|` (or).
Parentheses `()` control grouping — `&` binds tighter than `|`.

## @if / @else / @endif

$livingLight = light[living_room]
$kitchenLight = @oneof(light[kitchen])

@if $livingLight.power? == on
    $kitchenLight.power = on
    speaker[kitchen].play()
@else
    $kitchenLight.power = off
@endif

Note: use `@oneof(device[room])` before a condition when the device
type could be ambiguous — even with a room selector, a room may have
multiple devices of the same type.

## @oneof for condition variables

Condition paths must resolve to a single concrete device.
Pre-resolve the variable with `@oneof` (see Collection modifiers):

$tv = @oneof(tv[living_room])
@if $tv.power? == on
    speaker[living_room].power = on
@endif

Without @oneof, an ambiguous variable in a condition triggers an error.

## Syntax

Simple condition:
@if <path>? == <value>
    <statements>
@else           (optional)
    <statements>
@endif

With @oneof (recommended):
$var = @oneof(device[room])
@if $var.property? == value
    ...
@endif

Compound conditions:
@if <cond1> & <cond2>
    ...

@if <cond1> | <cond2>
    ...

@if (<cond1> | <cond2>) & <cond3>
    ...

## Operators

- `==` — equals
- `!=` — not equals
- `&` — logical AND (higher precedence)
- `|` — logical OR (lower precedence)
- `(...)` — explicit grouping

## Rules

- The condition path uses the query syntax (`?`) to read a property value.
- Conditions compare against `on`/`off`, numbers, enum identifiers,
  or quoted strings.
- ALWAYS pre-resolve condition devices with `$var = @oneof(device[room])`
  to avoid ambiguity errors.
- If the device is already unambiguous (exactly one in the room),
  a direct assignment like `$var = device[room]` also works.
- An ambiguous device in a condition triggers an error — 
  there is no way to know which device to check.
- Multiple conditions can be combined with `&` and `|`.
- `&` binds tighter than `|` — use `(...)` for explicit grouping.
- `@if` blocks can be nested.
- Empty bodies are valid.

---

# USAGE GUIDELINES

- Device expressions are always abstract (device type level).
- Do not use device-specific IDs — keep expressions generic.
- If a property or action might not exist for the target device,
  it is still valid DSL syntax.
- Owner selectors let you target devices belonging to a specific person.
  Only use owners listed in the OWNERS section.

Valid:
tv.power = on

Invalid:
device(tv_lg_001).power = on

---

# INVALID PATTERNS

The following patterns are not valid HomeDSL:

$tv[living_room].power = on     — room selector on variable
$it = tv[living_room]             — reassigning read-only $it
$it.power = on              — $it used before being set
tv.brightness = 50          — TV has no brightness property
                              (still valid syntax)

---

# AMBIGUITY

An expression is ambiguous when it matches several devices and no
disambiguation tool is applied (e.g. tv.power = on with two TVs).

Consequences:
- In a statement: pauses and asks the user to pick one device.
- In an @if condition: an error — pre-resolve with @oneof.

Disambiguation tools:
- device[room] / device[owner:name] / device[tag:name] — narrow the match
- @all(...) or [*] — target every match (batch)
- @first(...)     — target the first match
- @oneof(...)     — target one device; if several match, let the user choose

Rule of thumb: "all" → @all or [*]; "any one" → @first;
"one I can name" → selector; "one I can't name" → @oneof.

---

# GENERAL PRINCIPLE

HomeDSL describes intent at the device-type level.
It does not assume which specific devices exist or where they are.

Device selection and disambiguation are handled automatically based on
device type and room. You never need device-specific IDs.

---

# EXAMPLES

"Turn on the living room TV"
→ tv[living_room].power = on

"Turn on the TV"
→ tv.power = on

"Turn it off"
→ $it.power = off

"Set temperature to 21"
→ thermostat.temperature = 21

"Turn off all lights"
→ light[*].power = off

"Play music"
→ speaker.play()

"Turn on the first TV"
→ $tv = @first(tv)
$tv.power = on

"Turn off all office lights"
→ $officeLights = @all(light[office])
$officeLights.power = off

"What's the living room temperature?"
→ thermostat[living_room].temperature?

"Lock the front door"
→ door[entrance].lock()

"Dim the bedroom light to 20%"
→ light[bedroom].brightness = 20

"Stop the vacuum and turn on the camera"
→ vacuum.stop()
camera.snapshot()

"Turn off Alice's lights"
→ $alice = @all(light[owner:Alice])
$alice.power = off

"Dim the children's bedroom lights to 20%"
→ light[bedroom][owner:kids].brightness = 20

"Lock all of Alice's doors"
→ door[owner:Alice].lock()

"Turn off Alice's lights"
→ $alice = @all(light[owner:Alice])
$alice.power = off

"Dim the children's bedroom lights to 20%"
→ light[bedroom][owner:kids].brightness = 20

"Lock all of Alice's doors"
→ door[owner:Alice].lock()

"If the living room light is on, turn on the kitchen light too"
→ $livingLight = light[living_room]
$kitchenLight = @oneof(light[kitchen])
@if $livingLight.power? == on
$kitchenLight.power = on
@endif

"If the temperature is above 25, turn on the fan, otherwise turn it off"
→ $therm = thermostat[living_room]
$fan = @oneof(fan[living_room])
@if $therm.temperature? == 25
    $fan.power = on
@else
    $fan.power = off
@endif

"If the living room light AND the TV are both on, turn on the speaker"
→ $livingLight = light[living_room]
$livingTv = @oneof(tv[living_room])
@if $livingLight.power? == on & $livingTv.power? == on
speaker[living_room].power = on
@endif

"If the living room light OR the kitchen light is on, close the blinds"
→ $livingLight = light[living_room]
$kitchenLight = @oneof(light[kitchen])
@if $livingLight.power? == on | $kitchenLight.power? == on
blind[living_room].position = 0
@endif

"If the TV is off AND (it is hot OR the fan is on), turn on the AC"
→ $tv = @oneof(tv[living_room])
$therm = thermostat[living_room]
$fan = @oneof(fan[living_room])
@if $tv.power? != on & ($therm.temperature? == 25 | $fan.power? == on)
thermostat[living_room].temperature = 20
@endif
