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

- salon
- chambre
- cuisine
- bureau
- salle_de_bain
- entrée

Room selector syntax:

- device[room_name] — targets a specific room
- light[*] — targets ALL rooms (bypasses ambiguity, batch execution)

Rooms are logical labels — they describe where a device is placed.
Devices are matched to rooms at runtime based on the actual inventory.

The wildcard [*] bypasses ambiguity: light[*].power = off
turns off lights in every room without requiring resolution.

[*] can be combined with @all: @all(light[*]) stores all lights
from every room in a single variable.

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
- color (optional)
- mode (optional)

## SPEAKER
Properties:
- power (on/off)
- volume (0–100)

Actions (callable):
- play()
- pause()
- next()

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
- snapshot()

## VACUUM
Actions (callable):
- start()
- stop()

## NIGHTSTAND
Properties:
- light.power (on/off)
- brightness (0–100)

Note: `light.power` is a single property name (not a nested path).

## DOOR
Properties:
- state (optional)

Actions (callable):
- lock()
- unlock()

## SWITCH
Properties:
- power (on/off)

# SYNTAX

## State assignment
tv[salon].power = on

light[chambre].brightness = 50

## Variable assignment
$tv = tv[salon]

$lights = @all(light[salon])
$firstTv = @first(tv) (selects the first matching device)

`@all` and `@first` are collection modifiers.
They are only valid in variable assignments, never inline in property paths.

## Variable usage
$tv.power = on

$lights.power = off

Variables are prefixed with $ (both when defining and using).
A variable stores a device or collection reference for reuse.

Variable constraints:
- Room selectors on variables are invalid:
  $tv[salon].power = on → INVALID
- $it is read-only (auto-managed at runtime):
  $it = tv[salon] → INVALID
- Variables remember their collection modifier.
  $lights = @all(light[salon]) keeps @all semantics.
- $it is auto-set after every successful device resolution.
  It persists across statements and across calls within a session.
- Using $it as the first statement of a program has no effect —
  it will not be set yet.

## Query
tv.power?

thermostat.temperature?

## Increment
speaker.volume += 10

## Action
vacuum.start()

camera.snapshot()

## Context reference
$it.power = off
$it.volume = 20

`$it` refers to the most recently resolved device.

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

$light_salon = light[salon]
$light_cuisine = light[cuisine]

@if $light_salon.power? == "on"
    $light_cuisine.power = on
    speaker[cuisine].play()
@else
    $light_cuisine.power = off
@endif

## Syntax

Simple condition:
@if <path>? == <value>
    <statements>
@else           (optional)
    <statements>
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
- Conditions compare against `on`, `off`, numbers, or quoted strings.
- Variables are recommended for conditions to avoid ambiguity:
  pre-resolve the device with `$var = device[room]` before the `@if`.
- Multiple conditions can be combined with `&` and `|`.
- `&` binds tighter than `|` — use `(...)` for explicit grouping.
- `@if` blocks can be nested.
- Empty bodies are valid.

---

# USAGE GUIDELINES

- Device expressions are always abstract (device type level).
- Do not use device-specific IDs — keep expressions generic.
- If a property or action might not exist for the target device,
  it is still valid DSL — the runtime handles invalid operations.

Valid:
tv.power = on

Invalid:
device(tv_lg_001).power = on

---

# INVALID PATTERNS

The following patterns are not valid HomeDSL:

$tv[salon].power = on     — room selector on variable
$it = tv[salon]             — reassigning read-only $it
$it.power = on              — $it used before being set
tv.brightness = 50          — TV has no brightness property
                              (still valid syntax, runtime handles)

---

# AMBIGUITY RESOLUTION

When a device expression matches multiple devices, the runtime returns
a waiting state with a candidate list. The caller must pick a device
and re-submit the program.

Example:

"Turn on the TV"
→ tv.power = on

If there are multiple TVs, the runtime returns a waiting state —
the DSL itself does not specify which TV.

Devices can be pre-resolved before execution:
- session.resolvedIds stores resolved device choices
- applyResolution() picks a specific device

---

# GENERAL PRINCIPLE

HomeDSL describes intent at the device-type level.
It does not assume which specific devices exist or where they are.

The runtime handles:
- device selection (matching type + room to inventory)
- room disambiguation
- candidate resolution and filtering

---

# OUTPUT FORMAT

HomeDSL output consists of raw DSL lines, one per line.
No markdown fences (```), no backticks, no explanatory text.

If a request cannot be expressed in HomeDSL,
output nothing (empty response).

---

# EXAMPLES

"Turn on the living room TV"
→ tv[salon].power = on

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
→ $officeLights = @all(light[bureau])
$officeLights.power = off

"What's the living room temperature?"
→ thermostat[salon].temperature?

"Lock the front door"
→ door[entrée].lock()

"Dim the bedroom light to 20%"
→ light[chambre].brightness = 20

"Stop the vacuum and turn on the camera"
→ vacuum.stop()
camera.snapshot()

"If the salon light is on, turn on the kitchen light too"
→ $salon = light[salon]
$cuisine = light[cuisine]
@if $salon.power? == "on"
$cuisine.power = on
@endif

"If the temperature is above 25, turn on the fan, otherwise turn it off"
→ $temp = thermostat[salon]
$fan = fan[salon]
@if $temp.temperature? == 25
    $fan.power = on
@else
    $fan.power = off
@endif

"If the salon light AND the TV are both on, turn on the speaker"
→ $salon = light[salon]
$salon_tv = tv[salon]
@if $salon.power? == on & $salon_tv.power? == on
speaker[salon].power = on
@endif

"If the salon light OR the kitchen light is on, close the blinds"
→ $salon = light[salon]
$cuisine = light[cuisine]
@if $salon.power? == on | $cuisine.power? == on
blind[salon].position = 0
@endif

"If the TV is off AND (it is hot OR the fan is on), turn on the AC"
→ $tv = tv[salon]
$therm = thermostat[salon]
$fan = fan[salon]
@if $tv.power? != on & ($therm.temperature? == 25 | $fan.power? == on)
thermostat[salon].temperature = 20
@endif
