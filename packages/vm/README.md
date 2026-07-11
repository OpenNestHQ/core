# @opennest/vm

HomeDSL interpreter — device resolution, ambiguity handling, state management, and execution.

## Install

```bash
pnpm add @opennest/vm
```

## API

### `interpret_home_dsl(program, context): Promise<VMResult>`

Main entry point. Takes a parsed AST and device context, returns execution result.

```ts
import { interpret_home_dsl, createSession } from "@opennest/vm";

const result = await interpret_home_dsl(program, {
  devices: myDevices,
  session: createSession(),
});

// result.status → "success" | "waiting" | "error"
```

### Session management

```ts
import { createSession, applyResolution } from "@opennest/vm";

const session = createSession();
// ... after VM returns "waiting" with ambiguity ...
applyResolution(session, "tv", "tv_salon");
// re-invoke interpret_home_dsl with updated session
```

### Resolution & collections

```ts
import { resolveDevices, expandCollection } from "@opennest/vm";
```

### Executors (low-level)

```ts
import { executeAssignment, executeQuery, executeAction, evaluateCondition } from "@opennest/vm";
```

## VMResult

```ts
{
  status: "success" | "waiting" | "error",
  session: Session,           // updated session (variables, history, $it)
  executed: ExecutedStatement[],
  awaiting: AmbiguityInfo | null,  // structured ambiguity tree when status === "waiting"
  errors: VMError[]
}
```

## Key features

- **Ambiguity as first-class state** — returns `AmbiguityInfo` tree instead of failing
- **Intent filtering** — auto-excludes devices that don't support targeted properties/actions
- **Stateful sessions** — variables, `$it` context, and history persist across calls
- **Collections** — `@all`, `@first`, `@oneof` with batch execution
- **Conditions** — `@if`/`@else`/`@endif` with `&` (AND) and `|` (OR)

## Exports

| Export | Kind | Description |
|---|---|---|
| `interpret_home_dsl` | function | Main VM entry point |
| `interpretProgram` | function | Core interpreter (used internally) |
| `createSession` | function | Create a fresh session |
| `applyResolution` | function | Resolve ambiguity by device ID |
| `resolveAmbiguity` | function | Resolve ambiguity via intent |
| `resolveLastAmbiguity` | function | Resolve last ambiguity from session |
| `resolveDevices` | function | Resolve device references |
| `resolveDeviceById` | function | Resolve a single device by ID |
| `expandCollection` | function | Expand `@all`/`@first`/`@oneof` |
| `selectFirst` | function | Select first match from collection |
| `selectAll` | function | Select all matches from collection |
| `buildAmbiguityInfo` | function | Build structured ambiguity tree |
| `executeAssignment` | function | Execute assignment statement |
| `executeIncrement` | function | Execute increment statement |
| `executeQuery` | function | Execute query statement |
| `executeAction` | function | Execute action statement |
| `evaluateCondition` | function | Evaluate `@if` condition |
