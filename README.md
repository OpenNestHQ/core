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
| [vm](./packages/vm/) | `@opennest/vm` | Interpreter: resolution, middleware, interactions, validation, tracing |
| [playground](./examples/playground/) | `@opennest/playground` | Interactive TUI REPL with 14 mock devices + NL→DSL AI agent |
| [sdk](./packages/sdk/) | `@opennest/sdk` | High-level `OpenNestClient` facade over parser + VM + devices |

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

**11 device types**: `tv`, `light`, `speaker`, `thermostat`, `fan`, `blind`, `camera`, `vacuum`, `nightstand`, `door`, `switch` — each can have optional `owners` and `tags`

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

# Owner selectors (who owns the device)
light[owner:Alice].power = on
speaker[owner:Bob].volume = 30

# Tag selectors (category/role of the device)
light[tag:main].power = off
camera[tag:security].snapshot()

# Chained selectors (room + owner + tag — all must match, AND logic)
light[salon][owner:Alice][tag:main].brightness = 80

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

### Selectors (room, owner, tag)

Devices can be targeted by three selector types, chainable as `[room][owner:name][tag:name]` (AND logic):

| Selector | Syntax | What it filters |
|---|---|---|
| Room | `type[room_name]` | Physical location (where) |
| Owner | `type[owner:name]` | Person who owns the device (whose) |
| Tag | `type[tag:name]` | Category / feature / role (what) |
| Wildcard | `[*]` | All rooms |

Owners and tags are optional fields on each device. If a device has no `owners`/`tags`, it will match only queries without `owner:`/`tag:` selectors.

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
| `confirmation` | A middleware requires user approval | `confirmed: boolean` |
| `text_input` | Free-form text input needed | `text: string` |
| `number_input` | Numeric input needed | `value: number` |
| `choice` | Pick from options | Selected `value: string` |

### Intent filtering (auto-disambiguation)

When a statement targets a property or action, the resolver filters out devices that don't support it. This can auto-disambiguate without user input. Each `ExecutedStatement` includes a `ResolutionFilter` with counts and per-device exclusion reasons.

---

## Middleware

Middleware forms a **composable pipeline** between statement resolution and device execution using the Koa-style `(ctx, next)` pattern. Each `(device, operation)` pair passes through an ordered chain of `Middleware` functions before dispatch.

### Built-in middleware

| Middleware | Behavior |
|---|---|
| `noopMiddleware` | Always allows — template/skeleton |
| `createConfirmationMiddleware(opts)` | Pauses for user confirmation on matching actions |

### Flow control

Middleware uses **throw-based signals** for flow control:
- **`BlockSignal(reason)`** — reject the action
- **`SkipSignal(reason?)`** — bypass silently
- **`PauseSignal(interaction, context?)`** — suspend for user interaction
- **`ExpandSignal(actions[])`** — split into multiple actions
- **`replace`** — mutate `ctx.action` then `await next()`

The VM context accepts an optional `middleware: Middleware[]`:

```ts
import { createConfirmationMiddleware } from "@opennest/vm";

const confirmVacuum = createConfirmationMiddleware({
  requireConfirmation: (action) => action.method === "start",
  message: "Start the vacuum?",
});

const result = await executeCommand(
  { kind: "run_program", program },
  { devices, session, middleware: [confirmVacuum] },
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
| `Middleware` | Middleware evaluation per `PlannedAction` |
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

## SDK

The `@opennest/sdk` package exposes a single `OpenNestClient` facade over the whole pipeline — parse → VM → devices — for building applications on top of OpenNest. No embedded LLM: the host supplies the model.

### Quick start

```ts
import { OpenNestClient } from "@opennest/sdk";
import { MockDriver } from "@opennest/devices";

const client = new OpenNestClient({
  devices: [
    {
      id: "tv_salon",
      type: "tv",
      room: "salon",
      name: "Salon TV",
      driver: new MockDriver(),
      driverConfig: {},
    },
  ],
});

const result = await client.runDsl("tv[salon].power = on"); // status: "success"
```

### Facade

| Method | Description |
|---|---|
| `parse(dsl)` | Parse HomeDSL into a `Program`; throws `ParseError` on invalid DSL |
| `execute(program)` | Execute a parsed `Program` → `Promise<VMResult>` |
| `runDsl(dsl)` | `execute(parse(dsl))` in one call |
| `resume(response)` | Resume a suspended interaction with a `UserResponse` |
| `cancel()` | Cancel the current execution and reset the session |
| `getSession()` | Return the current `Session` (variables, history, `$it`, …) |

### LLM helpers

`buildPrompt(promptOptions?)` renders a HomeDSL prompt from the inventory's `PromptDefinitions` for the host's own LLM. It needs either a `DeviceRegistry` or an explicit `promptDefinitions`; a client built from a bare `Device[]` with neither throws.

`analyze(dsl)` runs `parseHomeDSL` + `validateProgram` without executing and returns typed feedback — no throw, no retry loop:

```ts
const feedback = client.analyze("tv[unknown_room].power = on");

// {
//   program: Program | null,          // null when parsing failed
//   parseErrors: ParseErrorInfo[],    // { message, line, column }
//   validationErrors: VMError[],      // { statement, message }
//   ok: boolean,
// }
```

### Interaction round-trip

On `status: "awaiting_interaction"`, read the typed `UserInteraction` and reply with a matching `UserResponse` via `resume(response)`:

```ts
const result = await client.runDsl("$tv = @oneof(tv)");
// With ≥2 TVs in the inventory, this suspends with `awaiting_interaction`.

if (result.status === "awaiting_interaction" && result.interaction) {
  const interaction = result.interaction; // typed UserInteraction
  // e.g. { id, type: "device_selection", message, devices }

  const resumed = await client.resume({
    interactionId: interaction.id,
    type: "device_selection",
    deviceId: "tv_salon",
  });
}
```

Each `UserInteraction` (`device_selection`, `confirmation`, `text_input`, `number_input`, `choice`, `action_parameter`) carries an `id` to copy into the `interactionId` field of the matching `UserResponse`.

An optional `onInteraction(interaction)` callback fires whenever a run returns `awaiting_interaction` with a non-null `interaction`, so the host can react without polling the result. It is fire-and-forget (`run()` never awaits it); errors are routed to `onInteractionError(error, interaction)` when provided, otherwise ignored.

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
      middleware/      # Middleware pipeline, signals, confirmation
      trace/          # VMEventBus, ExecutionTracer, event types
      interpreter.ts  # Main execution loop
      resolver.ts     # Device resolution
      executor.ts     # Assignment, query, action, condition execution
      state.ts        # Session management
      collections.ts  # @all, @first expansion
      validate.ts     # Pre-execution static validation
    __fixtures__/     # Sample inventory.yaml
  sdk/               # High-level client facade
    src/
      client.ts       # OpenNestClient (parse/execute/runDsl/resume/cancel/getSession)
      index.ts        # Public exports
examples/
  playground/        # Interactive TUI REPL
    src/
      repl.ts         # Readline-based REPL with tab-completion
      agent.ts        # NL→DSL AI translator (OpenAI via ai-sdk)
      devices.ts      # 14 mock devices across 4 rooms
      format.ts       # Colored terminal output
  web-playground/    # Next.js web UI
    lib/vm/           # VM adapter + device fixtures
    hooks/            # use-vm() React context + reducer
```

---

## Design Principles

1. **Separation of concerns** — LLM = compiler, VM = execution engine
2. **Deterministic execution** — same DSL + same state → same result
3. **Structured interactions** — user input is a first-class typed state, not an error
4. **Composable middleware** — pipeline for authorization, confirmation, transformation
5. **Stateful runtime** — session remembers variables, selections, history
6. **DSL as interface contract** — HomeDSL is the only interface between LLM and system

---

## Philosophy

> "The world is not controlled by prompts, but by languages."

OpenNest turns intent into execution through a structured, deterministic language layer.
