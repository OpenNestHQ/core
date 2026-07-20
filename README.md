# OpenNest

> A DSL runtime for smart environments — also known as ClawNest.

OpenNest is a language, virtual machine, and agent runtime designed to control and reason about smart environments through a structured DSL called **HomeDSL**.

```text
Natural Language → HomeAgent (LLM) → HomeDSL → VM (executeCommand) → Devices
```

---

## Packages

| Package | npm name | Role |
|---|---|---|
| [lang-core](./packages/lang-core/) | `@opennest/lang-core` | Parser (HomeDSL → AST), prompt generator, AST types |
| [devices](./packages/devices/) | `@opennest/devices` | Device registry, `DeviceDriver` interface, mock + HA drivers |
| [vm](./packages/vm/) | `@opennest/vm` | Interpreter: resolution, policies, interactions, validation, tracing |
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

## VM API

The VM exposes a single entry point `executeCommand` that accepts a discriminated union of commands:

```ts
import { executeCommand, createSession } from "@opennest/vm";

// Run a parsed program
const result = await executeCommand(
  { kind: "run_program", program },
  { devices: myDevices, session: createSession() },
);

// Resume after a user interaction
const resumed = await executeCommand(
  { kind: "resume_interaction", response },
  { devices: myDevices, session: result.session },
);

// Cancel execution
await executeCommand(
  { kind: "cancel_execution" },
  { devices: myDevices, session },
);
```

### Command types

| Command | Description |
|---|---|
| `run_program` | Execute a full parsed HomeDSL program |
| `execute_action` | Execute a single action, optionally scoped to a device |
| `execute_statement` | Execute a single statement, optionally scoped to a device |
| `resume_interaction` | Resume execution after a user interaction |
| `cancel_execution` | Cancel and reset the session |

### VMResult

```ts
{
  status: "success" | "awaiting_interaction" | "error",
  session: Session,
  executed: ExecutedStatement[],
  interaction: UserInteraction | null,
  errors: VMError[]
}
```

---

## User Interactions

The VM uses an **extensible user interaction system** instead of hardcoding ambiguity. When execution requires user input, it returns `status: "awaiting_interaction"` with a typed `UserInteraction` payload. The caller resumes via `resume_interaction` with a matching `UserResponse`.

### Interaction types

| Type | When | Response |
|---|---|---|
| `device_selection` | Multiple devices match a reference | Selected `deviceId` |
| `confirmation` | A policy requires user approval | `confirmed: boolean` |
| `text_input` | Free-form text input needed | `text: string` |
| `number_input` | Numeric input needed | `value: number` |
| `choice` | Pick from options | Selected `value: string` |

### Intent filtering (auto-disambiguation)

When a statement targets a property or action, the resolver filters out devices that don't support it. This can auto-disambiguate without user input. Each `ExecutedStatement` includes a `ResolutionFilter` with counts and per-device exclusion reasons.

---

## Execution Policies

Policies form a **composable middleware pipeline** between statement resolution and device execution. Each `(device, operation)` pair passes through an ordered chain of `ExecutionPolicy` instances before dispatch.

### Built-in policies

| Policy | Behavior |
|---|---|
| `NoopExecutionPolicy` | Always allows — template/skeleton |
| `ConfirmationPolicy` | Pauses for user confirmation on matching actions |

### Policy decisions

Policies return one of: `continue`, `block` (reject with reason), `skip` (bypass silently), `pause` (suspend for user interaction), `replace` (substitute action), or `expand` (expand into multiple actions).

The VM context accepts an optional `policies: ExecutionPolicy[]`:

```ts
import { ConfirmationPolicy } from "@opennest/vm";

const confirmVacuum = new ConfirmationPolicy({
  requireConfirmation: (action) => action.method === "start",
  message: "Start the vacuum?",
});

const result = await executeCommand(
  { kind: "run_program", program },
  { devices, session, policies: [confirmVacuum] },
);
```

---

## Pre-execution Validation

`validateProgram(program, devices, session?)` statically checks all statements before execution and returns `VMError[]` — no side effects. It validates:

- Device types and rooms exist in the inventory
- Properties and actions are supported by target devices
- `$it` is set before use
- `$variables` are defined before reference
- `@if` conditions don't contain ambiguous device references (except `@oneof` variables)

The validator is automatically called at the start of `interpretProgram` on fresh executions (`cursor === 0`).

---

## Execution Trace

An optional **deterministic execution trace** records the full VM execution as a tree of `ExecutionNode` objects. Enable it by passing an `eventBus` in the context:

```ts
import { DefaultVMEventBus, DefaultExecutionTracer } from "@opennest/vm";

const eventBus = new DefaultVMEventBus();
const tracer = new DefaultExecutionTracer();
eventBus.on(tracer.consume.bind(tracer));

const result = await executeCommand(
  { kind: "run_program", program },
  { devices, session, eventBus },
);

const trace = tracer.getTrace(); // { root: ExecutionNode }
```

### Node types captured

| NodeKind | What |
|---|---|
| `Program` | Root — one per `executeCommand` call |
| `Statement` | One per DSL statement; `@if` bodies appear as children |
| `Handler` | Interaction handler execution (device selection, confirmation) |
| `Policy` | Policy evaluation per `PlannedAction` |
| `Execute` | `setProperty` / `readProperty` / `incrementProperty` / `invokeAction` calls |

Each node records `startedAt`, `endedAt`, `duration`, `status` (Running / Success / Failed / Waiting / Skipped), and arbitrary `attributes`.

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
      ast/            # AST types + builders (buildProgram, buildAction, etc.)
      parser/         # parseHomeDSL()
      prompt/         # generateHomeAgentPrompt(), defaults, types
  devices/           # Device registry + drivers
    src/
      drivers/        # DeviceDriver interface, MockDriver, HADriver
      registry.ts     # DeviceRegistry (YAML → devices)
  vm/                # VM interpreter
    src/
      commands/       # VMCommand types, executeCommand() dispatcher
      interactions/   # UserInteraction types, handler registry, device-selection
      policies/       # ExecutionPolicy interface, pipeline, confirmation
      trace/          # VMEventBus, ExecutionTracer, event types
      interpreter.ts  # Main execution loop
      resolver.ts     # Device resolution
      executor.ts     # Assignment, query, action, condition execution
      state.ts        # Session management
      collections.ts  # @all, @first expansion
      validate.ts     # Pre-execution static validation
    __fixtures__/     # Sample inventory.yaml
  playground/        # Interactive TUI REPL
    src/
      repl.ts         # Readline-based REPL with tab-completion
      agent.ts        # NL→DSL AI translator (OpenAI via ai-sdk)
      devices.ts      # 14 mock devices across 4 rooms
      format.ts       # Colored terminal output
```

---

## Design Principles

1. **Separation of concerns** — LLM = compiler, VM = execution engine
2. **Deterministic execution** — same DSL + same state → same result
3. **Structured interactions** — user input is a first-class typed state, not an error
4. **Composable policies** — middleware pipeline for authorization, confirmation, transformation
5. **Stateful runtime** — session remembers variables, selections, history
6. **DSL as interface contract** — HomeDSL is the only interface between LLM and system

---

## Philosophy

> "The world is not controlled by prompts, but by languages."

OpenNest turns intent into execution through a structured, deterministic language layer.
