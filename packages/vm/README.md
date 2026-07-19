# @opennest/vm

HomeDSL interpreter — device resolution, ambiguity handling, state management, and execution.

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

## Key features

- **Ambiguity as first-class state** — returns interaction instead of failing on ambiguous device references
- **Intent filtering** — auto-excludes devices that don't support targeted properties/actions
- **Stateful sessions** — variables, `$it` context, and history persist across calls
- **Collections** — `@all`, `@first` with batch execution
- **Conditions** — `@if`/`@else`/`@endif` with `&` (AND) and `|` (OR)
- **Policies** — `ExecutionPolicy` interface with confirmation, blocking, skipping, expansion
