# @opennest/vm

HomeDSL interpreter — device resolution, interactions, middleware, validation, and execution tracing.

## Install

```bash
pnpm add @opennest/vm
```

## API

### `executeCommand(command, context): Promise<VMResult>`

Single entry point. Accepts a discriminated union of commands:

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

// Cancel current execution
await executeCommand(
  { kind: "cancel_execution" },
  { devices: myDevices, session },
);
```

### `createSession(): Session`

Creates a fresh VM session (variables, history, `$it` context).

### `validateProgram(program, devices, session?): VMError[]`

Pre-validates a program before execution. Returns validation errors without side effects.

### `VMResult`

```ts
{
  status: "success" | "awaiting_interaction" | "error",
  session: Session,
  executed: ExecutedStatement[],
  interaction: UserInteraction | null,
  errors: VMError[]
}
```

## Command types

| Command | Description |
|---|---|
| `RunProgramCommand` | Execute a full DSL program (`kind: "run_program"`) |
| `ExecuteActionCommand` | Execute a single action on a device (`kind: "execute_action"`) |
| `ExecuteStatementCommand` | Execute a single statement (`kind: "execute_statement"`) |
| `ResumeInteractionCommand` | Resume after user interaction (`kind: "resume_interaction"`) |
| `CancelExecutionCommand` | Cancel and reset session (`kind: "cancel_execution"`) |

## User interactions

The VM suspends with `status: "awaiting_interaction"` and a typed `interaction` payload. Resume with `resume_interaction` + matching `UserResponse`.

| Interaction type | When | Response |
|---|---|---|
| `device_selection` | Multiple devices match | `{ deviceId }` |
| `confirmation` | Middleware requires approval | `{ confirmed }` |
| `text_input` | Raised by middleware through `ask()` | `{ text }` |
| `number_input` | Raised by middleware through `ask()` | `{ value }` |
| `choice` | Raised by middleware through `ask()` | `{ value }` |

Answers to `ask()` questions are validated: a `number_input` outside `min`/`max` (inclusive) or not finite, an empty `text_input` (after trimming), or a `choice` value that is not one of the options is rejected with the error code `invalid_response`. The error is retryable and the question stays pending.

## Middleware

Composable Koa-style pipeline per `(device, operation)`. Add `middleware` to `VMContext`:

```ts
import { createConfirmationMiddleware } from "@opennest/vm";

const confirmVacuum = createConfirmationMiddleware({
  requireConfirmation: (action) => action.method === "start",
});

const result = await executeCommand(
  { kind: "run_program", program },
  { devices, session, middleware: [confirmVacuum] },
);
```

Built-in middleware: `noopMiddleware` (always passthrough), `createConfirmationMiddleware(opts)` (pause and confirm).

Flow control via signals: `BlockSignal`, `SkipSignal`, `PauseSignal`, `ExpandSignal`. Replace via `ctx.action` mutation + `await next()`.

### Asking questions with `ask()`

`createAsk()` returns a synchronous `ask(ctx, question)` that either returns the answer or pauses the run with a `text_input`, `number_input` or `choice` interaction. After the user answers, the pipeline is replayed and `ask` returns the answer; the device command is never sent before it.

```ts
import { createAsk, type Middleware } from "@opennest/vm";

const ask = createAsk();

const askTemperature: Middleware = (ctx, next) => {
  if (
    ctx.action.kind === "set_property" &&
    ctx.action.device.type === "thermostat" &&
    ctx.action.property === "temperature"
  ) {
    const value = ask(ctx, {
      key: "temperature",
      type: "number_input",
      message: "Quelle température ?",
      min: 10,
      max: 30,
    });
    ctx.action.value = { kind: "number", value };
  }
  return next();
};
```

- `scope`: `"device"` (default) asks once per device, so `@all(...)` asks one question per device; `"statement"` asks once per statement.
- Answers live for the current program run only and never leak into a later run. Each `createAsk()` has its own store, and one `ask` can be shared by several sessions.
- Known limitation: statements nested in one `@if` share a statement index, so two nested actions on the same device asking the same `key` share one answer.

## Execution tracing

Opt-in deterministic trace via `eventBus`:

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

Captures `Program`, `Statement`, `Handler`, `Middleware`, and `Execute` nodes with timing and status.

## Key features

- **User interactions** — extensible typed interaction system (not just ambiguity)
- **Intent filtering** — auto-excludes devices that don't support targeted properties/actions
- **Stateful sessions** — variables, `$it` context, and history persist across calls
- **Collections** — `@all`, `@first` with batch execution
- **Conditions** — `@if`/`@else`/`@endif` with `&` (AND) and `|` (OR)
- **Pre-validation** — static program validation before execution
- **Middleware** — composable chain for confirmation, blocking, skipping, expansion
- **Execution tracing** — deterministic event-bus-based trace tree
