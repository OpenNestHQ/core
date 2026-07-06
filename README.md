# ClawNest 🪺

> A domain-specific language runtime for intelligent environments.

ClawNest is a language, virtual machine, and agent runtime system designed to control and reason about smart environments through a structured DSL called HomeDSL.

It is not just a smart home framework. It is a compiler and execution engine for real-world agent interaction systems.

---

## 🧠 Core Idea

Instead of letting LLMs directly control devices or call tools with unstructured JSON, ClawNest introduces a strict separation:

```text
Natural Language
↓
HomeAgent (LLM Compiler)
↓
HomeDSL (Intermediate Language)
↓
ClawNest VM (interpret_home_dsl)
↓
Physical / Digital Environment
```

---

## 🏗 Architecture

ClawNest is composed of several layers:

### 1. HomeDSL

A minimal declarative language for expressing intentions in a structured way.

Example:

```text
tv[salon].power = on
it.volume = 20

light[*].power = off
```

### 2. VM (Interpreter)

The VM is responsible for:

- device resolution
- ambiguity handling
- state management
- execution
- collections such as `@all` and `@first`
- variables such as `it` and bindings
- session persistence

### 3. HomeAgent (LLM Compiler)

The HomeAgent transforms natural language into HomeDSL.

It does not:

- resolve devices
- access inventory
- execute actions

It only compiles intent into DSL.

### 4. Lang Core (TypeScript Package)

The `lang-core` package provides the language tooling foundation.

Its responsibilities include:

- parsing HomeDSL into an AST
- generating prompts for the HomeAgent
- validating DSL syntax
- preparing execution-ready structures

#### Package structure

```text
packages/
  lang-core/
    src/
      parser/
      prompt/
      ast/
      validator/
```

#### Features

- **DSL Parser**: parses HomeDSL into a structured AST.
- **Prompt Generator**: creates strict prompts for the HomeAgent.
- **DSL Validator**: checks syntax, allowed devices, correct capability usage, and modifier correctness.

---

## 🧠 HomeDSL Overview

### Supported device types

- `tv`
- `light`
- `speaker`
- `thermostat`
- `fan`
- `blind`
- `camera`
- `vacuum`
- `nightstand`
- `door`
- `switch`

### Core syntax

#### State assignment

```text
tv.power = on
light.brightness = 50
```

#### Queries

```text
tv.power?
thermostat.temperature?
```

#### Actions

```text
vacuum.start()
camera.snapshot()
```

#### Variables

```text
living_tv = tv[salon]
living_tv.power = on
```

#### Context reference

```text
it.volume = 20
```

#### Collections

```text
tvs = @all(tv[salon])
tvs.power = on
```

#### Modifiers

```text
@all
@first
@preferred
@strict
@delay
@notify
```

---

## ⚙️ VM Behavior

The ClawNest VM, exposed through `interpret_home_dsl`, is responsible for:

- parsing the DSL AST
- resolving references
- detecting ambiguity
- requesting clarification when needed
- executing actions
- updating session state

### Ambiguity handling

Instead of failing, the VM can return a waiting state such as:

```json
{
  "status": "waiting",
  "awaiting": {
    "kind": "target",
    "choices": [
      { "dsl": "tv[salon]", "label": "Salon TV" },
      { "dsl": "tv[chambre]", "label": "Bedroom TV" }
    ]
  }
}
```

### `@all` behavior

```text
@all(tv[salon])
```

This always:

- resolves all matches
- bypasses ambiguity
- expands into an explicit device list
- executes in batch mode

---

## 🧩 Design Principles

ClawNest is built around five core principles:

1. **Separation of concerns**
   - LLM = compiler
   - VM = execution engine

2. **Deterministic execution**
   - Same DSL + state → same result

3. **Structured ambiguity**
   - Ambiguity is a first-class state, not an error

4. **Stateful runtime**
   - The session remembers variables, selections, pending operations, and history

5. **DSL as interface contract**
   - HomeDSL is the only interface between the LLM and the system

---

## 🚀 Example Flow

**User**

> Turn on all the lights in the living room.

**HomeAgent output**

```text
lights = @all(light[salon])
lights.power = on
```

**VM execution**

- resolves 5 lights
- executes a batch update
- returns success

---

## 📁 Repository Structure

```text
clawnest/
  packages/
    lang-core/
      src/
        parser/
        prompt/
        ast/
        validator/
    vm/
    home-agent/
    devices/
```

---

## 🔮 Vision

ClawNest is not just a smart home system. It is a general-purpose DSL runtime for embodied agents.

Possible future extensions include:

- ClawNest Home (IoT)
- ClawNest Car (vehicle agents)
- ClawNest Office (productivity agents)
- ClawNest Cloud (digital agents)

---

## 🪺 Philosophy

> “The world is not controlled by prompts, but by languages.”

ClawNest turns intent into execution through a structured, deterministic language layer.