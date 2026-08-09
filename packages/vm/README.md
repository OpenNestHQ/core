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
| `text_input` | Text input needed | `{ text }` |
| `number_input` | Numeric input needed | `{ value }` |
| `choice` | Choose from options | `{ value }` |

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
