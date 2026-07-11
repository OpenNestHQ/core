# OpenNest

> A DSL runtime for smart environments — also known as ClawNest.

OpenNest is a language, virtual machine, and agent runtime designed to control and reason about smart environments through a structured DSL called **HomeDSL**.

```text
Natural Language → HomeAgent (LLM) → HomeDSL → VM (interpret_home_dsl) → Devices
```

---

## Packages

| Package | npm name | Role |
|---|---|---|
| [lang-core](./packages/lang-core/) | `@opennest/lang-core` | Parser (HomeDSL → AST), prompt generator, AST types |
| [devices](./packages/devices/) | `@opennest/devices` | Device registry, `DeviceDriver` interface, mock + HA drivers |
| [vm](./packages/vm/) | `@opennest/vm` | Interpreter: resolution, ambiguity, state, collections, conditions |
| [playground](./packages/playground/) | `@opennest/playground` | Interactive TUI REPL with 14 mock devices + NL→DSL AI agent |

---

## Quick Start

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run start          # Launch the playground REPL
```

---

## HomeDSL at a Glance

**11 device types**: `tv`, `light`, `speaker`, `thermostat`, `fan`, `blind`, `camera`, `vacuum`, `nightstand`, `door`, `switch`

### Syntax

```text
# State assignment
tv.power = on
light.brightness = 50

# Queries
tv.power?
thermostat.temperature?

# Actions
vacuum.start()
camera.snapshot()

# Variables ($-prefixed)
$salon_tv = tv[salon]
$salon_tv.power = on

# Context reference
$it.volume = 20

# Collections
$lights = @all(light[salon])
$lights.power = on

# Wildcard rooms
light[*].power = off

# Conditions
$tv = @oneof(tv)
@if $tv.power? == on
    light.power = off
@else
    light.power = on
@endif

# Compound conditions (& binds tighter than |)
@if $a.power? == on & ($b.temperature? == 25 | $c.power? == on)
    thermostat.temperature = 20
@endif
```

### Collection modifiers

| Modifier | Behavior |
|---|---|
| `@all(type[room])` | Expands to all matches, batch execution |
| `@first(type[room])` | Selects the first match |
| `@oneof(type[room])` | Resolves immediately to one device, ambiguity if multiple |
| `[*]` | Wildcard room — matches all rooms |

---

## VM Behavior

The VM (`interpret_home_dsl`) resolves device references, detects ambiguity, and executes statements — returning one of three statuses:

| Status | Meaning |
|---|---|
| `success` | All statements executed |
| `waiting` | Ambiguity detected — caller must pick a device via `applyResolution()` |
| `error` | One or more errors occurred |

### Key features

- **Ambiguity as a first-class state** — ambiguous device references return a structured `AmbiguityInfo` tree, not an error
- **Intent filtering** — devices that don't support a targeted property/action are auto-excluded
- **Stateful sessions** — variables, `$it` context, and execution history persist across VM calls

---

## Natural Language Mode

The playground includes an AI agent (`:nl` command) that translates natural language to HomeDSL:

```text
[NL] > turn on all lights in the living room and set the tv volume to 20
  Translated to HomeDSL:
  $lights = @all(light[salon])
  $lights.power = on
  $tv = @oneof(tv[salon])
  $tv.volume = 20
  ✓ OK
```

Requires `OPENAI_API_KEY` (or compatible API via `OPENAI_BASE_URL`). Uses `gpt-4o-mini` by default, overridable via `OPENNEST_MODEL`.

---

## Repository Structure

```
packages/
  lang-core/         # Parser + prompt generator
    src/
      ast/           # AST type definitions
      parser/        # parseHomeDSL()
      prompt/        # OpenNestPrompt, defaults, types
      validator/     # (future) AST validation
  devices/           # Device registry + drivers
    src/
      drivers/       # DeviceDriver interface, MockDriver, HADriver
      registry.ts    # DeviceRegistry (YAML → devices)
  vm/                # VM interpreter
    src/
      interpreter.ts # Main execution loop
      resolver.ts    # Device resolution
      executor.ts    # Assignment, query, action, condition execution
      state.ts       # Session management, ambiguity resolution
      collections.ts # @all, @first, @oneof expansion
      ambiguity.ts   # Ambiguity tree construction
    __fixtures__/    # Sample inventory.yaml
  playground/        # Interactive TUI REPL
    src/
      repl.ts        # Readline-based REPL with tab-completion
      agent.ts       # NL→DSL AI translator (OpenAI via ai-sdk)
      devices.ts     # 14 mock devices across 4 rooms
      format.ts      # Colored terminal output
```

---

## Design Principles

1. **Separation of concerns** — LLM = compiler, VM = execution engine
2. **Deterministic execution** — same DSL + same state → same result
3. **Structured ambiguity** — ambiguity is a first-class state, not an error
4. **Stateful runtime** — session remembers variables, selections, history
5. **DSL as interface contract** — HomeDSL is the only interface between LLM and system

---

## Philosophy

> "The world is not controlled by prompts, but by languages."

OpenNest turns intent into execution through a structured, deterministic language layer.
