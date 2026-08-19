# @opennest/sdk

Deterministic execution facade over the OpenNest pipeline: HomeDSL → parser → VM → devices. No embedded LLM.

## Install

```bash
pnpm add @opennest/sdk
```

## API

### `OpenNestClient`

```ts
import { OpenNestClient } from '@opennest/sdk'

const client = new OpenNestClient({ devices }) // Device[] or DeviceRegistry
```

A client can also be built from a YAML inventory file (the same format consumed by
`DeviceRegistry.fromYaml`):

```ts
const client = await OpenNestClient.fromYaml('./inventory.yaml', {
  middleware,
  onInteraction,
})
```

The extra options are the usual `OpenNestClientOptions` minus `devices`.

`fromYaml` reads the inventory file synchronously with `readFileSync`, so it is
Node-only and not available in the browser bundle.

| Method                  | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `parse(dsl)`            | Parse HomeDSL into a `Program`. Throws `ParseError` on invalid DSL. |
| `execute(program)`      | Execute a parsed `Program` → `Promise<VMResult>`.                   |
| `runDsl(dsl)`           | `execute(parse(dsl))` — parse + execute in one call.                |
| `resume(response)`      | Resume a suspended interaction with a `UserResponse`.               |
| `cancel()`              | Cancel the current execution and reset the session.                 |
| `getSession()`          | Return the current `Session` (variables, history, `$it`, …).        |
| `buildPrompt(options?)` | Generate a HomeDSL prompt from the inventory for an external LLM.   |
| `analyze(dsl)`          | Parse + validate without executing; return all typed errors.        |

### Options

```ts
interface OpenNestClientOptions {
  devices: Device[] | DeviceRegistry
  promptDefinitions?: PromptDefinitions
  middleware?: Middleware[]
  eventBus?: VMEventBus
  onInteraction?: (interaction: UserInteraction) => void | Promise<void>
  onInteractionError?: (error: unknown, interaction: UserInteraction) => void
}
```

| Option               | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `devices`            | `Device[]` or `DeviceRegistry` the client executes against.       |
| `promptDefinitions`  | Explicit prompt definitions for `buildPrompt`.                    |
| `middleware`         | VM middleware, e.g. `createConfirmationMiddleware(...)`.          |
| `eventBus`           | Optional VM event bus for tracing.                                |
| `onInteraction`      | Called when a run suspends with an `awaiting_interaction` result. |
| `onInteractionError` | Routed sink for callback errors; ignored when absent.             |

### LLM helpers (no embedded LLM)

`buildPrompt(promptOptions?)` reuses `OpenNestPrompt` and the inventory's
`PromptDefinitions` to render a prompt the host can hand to its own LLM. The
definitions come from the `DeviceRegistry` (kept as a reference) or from an
explicit `promptDefinitions` option. When the client is built from a bare
`Device[]` with neither source available, `buildPrompt` throws.

`analyze(dsl)` runs `parseHomeDSL` + `validateProgram` and returns every typed
error without throwing and without any retry loop — the NL→DSL loop stays with
the host:

```ts
{
  program: Program | null,          // null when parsing failed
  parseErrors: ParseErrorInfo[],    // { message, line, column }
  validationErrors: VMError[],      // { statement, message }
  ok: boolean,
}
```

### Execution result

`execute` / `runDsl` / `resume` / `cancel` all return a `VMResult`:

```ts
{
  status: "success" | "awaiting_interaction" | "error",
  session: Session,
  executed: ExecutedStatement[],
  interaction: UserInteraction | null,
  errors: VMError[],
}
```

On `awaiting_interaction`, read `interaction` and reply with a matching `UserResponse` via `resume(response)`.

`onInteraction` is invoked whenever a run returns `awaiting_interaction` with a
non-null `interaction`, so the host can react (e.g. render a prompt) without
polling the result. It is fire-and-forget: `run()` never awaits it, so a slow
handler does not block execution. It may return `void` or a `Promise<void>` —
either is accepted. A synchronous `throw` or a promise rejection is caught and
routed to `onInteractionError(error, interaction)` when provided, otherwise
ignored; if `onInteractionError` itself throws, the exception is silently
swallowed. The callback never rejects the `VMResult` returned by `run()`.

The `interaction` is a `UserInteraction` discriminated
union — `device_selection`, `confirmation`, `text_input`, `number_input`,
`choice`, `action_parameter` — each carrying an `id` to pass back verbatim in
the matching `UserResponse`.

`run()` (and therefore `execute` / `runDsl` / `resume` / `cancel`) is
non-reentrant: each call mutates the client's single `session` in place, so a
client must not run two executions concurrently. `await` the previous call
before starting the next one; for parallel executions, use one `OpenNestClient`
per execution.

## Example

```ts
import { OpenNestClient } from '@opennest/sdk'
import { MockDriver } from '@opennest/devices'

const driver = new MockDriver()
await driver.init({})
const client = new OpenNestClient({
  devices: [
    {
      id: 'tv_salon',
      type: 'tv',
      room: 'salon',
      name: 'Salon TV',
      driver,
      driverConfig: {},
    },
  ],
})

const result = await client.runDsl('tv[salon].power = on') // status: "success"
```
