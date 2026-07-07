# OpenNest

> A domain-specific language runtime for intelligent environments. Also known as ClawNest.

OpenNest is a language, virtual machine, and agent runtime system designed to control and reason about smart environments through a structured DSL called HomeDSL.

It is not just a smart home framework. It is a compiler and execution engine for real-world agent interaction systems.

---

## Core Idea

Instead of letting LLMs directly control devices or call tools with unstructured JSON, OpenNest introduces a strict separation:

```text
Natural Language
    ↓
HomeAgent (LLM Compiler)
    ↓
HomeDSL (Intermediate Language)
    ↓
OpenNest VM (interpret_home_dsl)
    ↓
Physical / Digital Environment
```

---

## Architecture

OpenNest is composed of four packages:

### 1. `lang-core` — Language toolkit

Parses HomeDSL into an AST and generates structured prompts for the LLM.

- **Parser**: `parseHomeDSL(source) → ParseResult` — validates syntax and produces a typed AST
- **Prompt generator**: `generateHomeAgentPrompt(config?) → string` — creates strict prompts for the HomeAgent
- **AST types**: `Program`, `Statement`, `Expr`, `Value`, etc.

### 2. `devices` — Device abstraction

Device registry and driver interface.

- **DeviceDriver interface**: `getProperty`, `setProperty`, `executeAction`, `init`
- **MockDriver**: in-memory driver for testing and development
- **HADriver**: REST API driver for Home Assistant
- **DeviceRegistry**: loads device inventories from YAML

### 3. `vm` — Interpreter

The execution engine. Takes a parsed AST and a device context, then:

- resolves device references
- detects and handles ambiguity
- executes assignments, queries, increments, and actions
- manages session state (variables, `it` context, history)
- supports collections (`@all`, `@first`) and wildcards (`[*]`)

### 4. `playground` — Interactive REPL

A terminal UI with 14 mock devices across 4 rooms for testing and demonstration. Starts an interactive readline-based session where you can type HomeDSL and see the VM execute it in real time.

---

## HomeDSL Overview

### Supported device types

`tv`, `light`, `speaker`, `thermostat`, `fan`, `blind`, `camera`, `vacuum`, `nightstand`, `door`, `switch`

### Core syntax

**State assignment:**
```text
tv.power = on
light.brightness = 50
```

**Queries:**
```text
tv.power?
thermostat.temperature?
```

**Actions:**
```text
vacuum.start()
camera.snapshot()
```

**Variables:**
```text
$living_tv = tv[salon]
$living_tv.power = on
```

Variables are prefixed with `$` to distinguish them from device types. The `$` is syntactic only — the name is stored without it internally.

**Context reference:**
```text
$it.volume = 20
```

**Collections:**
```text
$lights = @all(light[salon])
$lights.power = on
```

**Wildcard room selector:**
```text
light[*].power = off
```

---

## VM Behavior

The OpenNest VM, exposed through `interpret_home_dsl(program, context)`, is responsible for:

- parsing the DSL AST
- resolving device references
- detecting ambiguity
- requesting clarification when needed
- executing actions
- updating session state

### Ambiguity handling

Instead of failing, the VM returns a waiting state:

```json
{
  "status": "waiting",
  "awaiting": {
    "kind": "target",
    "tree": {
      "type": "tv",
      "children": [
        { "key": "salon", "dsl": "tv[salon]", "children": [{ "id": "tv_salon", "dsl": "tv[salon]" }] },
        { "key": "chambre", "dsl": "tv[chambre]", "children": [{ "id": "tv_chambre", "dsl": "tv[chambre]" }] }
      ]
    }
  }
}
```

The caller picks a device via `applyResolution(session, deviceType, deviceId)` and re-invokes the VM.

### Intent filtering

When a statement targets a property or action, the resolver excludes devices that don't support it (based on their `driverConfig`). This can resolve ambiguity automatically without user input.

### Collections

- `@all(type[room])` — expands to all matches, bypasses ambiguity, executes in batch
- `@first(type[room])` — selects the first match
- `[*]` wildcard room — matches devices in all rooms

---

## Design Principles

1. **Separation of concerns** — LLM = compiler, VM = execution engine
2. **Deterministic execution** — same DSL + same state → same result
3. **Structured ambiguity** — ambiguity is a first-class state, not an error
4. **Stateful runtime** — the session remembers variables, selections, history
5. **DSL as interface contract** — HomeDSL is the only interface between the LLM and the system

---

## Example Flow

**User:**
> Turn on all the lights in the living room.

**HomeAgent output:**
```text
$lights = @all(light[salon])
$lights.power = on
```

**VM execution:**
- resolves all lights in the salon
- executes a batch power update
- returns success

---

## Repository Structure

```
packages/
  lang-core/         # Parser + Prompt generator
    src/
      parser/        # parseHomeDSL()
      prompt/        # generateHomeAgentPrompt(), defaults, types
      ast/           # AST type definitions
  devices/           # Device registry + drivers
    src/
      drivers/       # DeviceDriver interface, MockDriver, HADriver
  vm/                # VM interpreter
    src/             # interpret_home_dsl(), resolver, state, executor
  playground/        # Interactive TUI REPL
    src/             # 14 mock devices, readline-based REPL
```

---

## Getting Started

```bash
# Build everything (order matters)
cd packages/devices && npm run build
cd packages/lang-core && npm run build
cd packages/vm && npm run build
cd packages/playground && npm run build

# Run tests
cd packages/devices && npm run test
cd packages/lang-core && npm run test
cd packages/vm && npm run test

# Start the playground REPL
cd packages/playground && npm start
```

---

## Philosophy

> "The world is not controlled by prompts, but by languages."

OpenNest turns intent into execution through a structured, deterministic language layer.
