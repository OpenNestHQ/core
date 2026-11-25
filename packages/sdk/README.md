# @opennest/sdk

Deterministic execution facade over the OpenNest pipeline: HomeDSL → parser → VM → devices. No embedded LLM: the host supplies the model.

## Install

```bash
pnpm add @opennest/sdk
```

## Quick start

```ts
import { OpenNestClient } from '@opennest/sdk'
import { MockDriver } from '@opennest/devices'

const driver = new MockDriver()
await driver.init({})

const client = new OpenNestClient({
  devices: [
    {
      id: 'tv_living_room',
      type: 'tv',
      room: 'living_room',
      name: 'Living room TV',
      driver,
      driverConfig: {},
    },
  ],
})

const result = await client.runDsl('tv[living_room].power = on') // status: 'success'
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

The extra options are `OpenNestClientFromYamlOptions`, i.e. the usual
`OpenNestClientOptions` minus `devices`. `fromYaml` takes a file **path** and
reads it synchronously with `readFileSync`, so it is Node-only and not
available in the browser bundle.

| Method                                 | Description                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `parse(dsl): Program`                  | Parse HomeDSL into a `Program`. Throws `ParseError` on invalid DSL.                                          |
| `buildPrompt(options?): string`        | Generate a HomeDSL prompt from the inventory for an external LLM. Throws without prompt definitions.         |
| `analyze(dsl): DSLFeedback`            | Parse + validate without executing; return all typed errors, never throws.                                   |
| `execute(program): Promise<RunResult>` | Execute a parsed `Program`.                                                                                  |
| `runDsl(dsl): Promise<RunResult>`      | `execute(parse(dsl))` — parse + execute in one call (throws `ParseError` on invalid DSL).                    |
| `resume(response)`                     | Resume a suspended interaction with a full `UserResponse` (`interactionId` included) → `Promise<RunResult>`. |
| `resumePending(answer)`                | Resume the pending interaction with a `ResumeAnswer` (a `UserResponse` without `interactionId`) → `Promise<RunResult>`; checks it first. |
| `cancel(): Promise<RunResult>`         | Cancel the current execution and reset the session (open suggestions are dropped).                           |
| `getSuggestions()`                     | List the open follow-up suggestions → `SuggestionSummary[]`.                                                 |
| `answerSuggestion(id, answer)`         | Answer an open suggestion (`answer: SuggestionResponse`) and run its follow-up → `Promise<RunResult>`.       |
| `dismissSuggestion(id): boolean`       | Drop one open suggestion; `true` if it existed.                                                              |
| `getSession(): Session`                | Return the current `Session` (variables, history, `$it`, …).                                                 |
| `getPendingInteraction()`              | Return the pending `UserInteraction`, or `null`.                                                             |
| `whenReady(): Promise<void>`           | Wait until the registry's drivers are ready (no-op for a bare `Device[]`).                                   |
| `close(): Promise<void>`               | Close the registry's drivers (no-op for a bare `Device[]`).                                                  |

`whenReady()` and `close()` only act when the client was built from a
`DeviceRegistry` (or `fromYaml`); with a bare `Device[]` the caller owns the
drivers.

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

`buildPrompt(promptOptions?)` renders a HomeDSL prompt from the inventory's
`PromptDefinitions` for the host's own LLM. The definitions come from the
`DeviceRegistry` (kept as a reference) or from an explicit `promptDefinitions`
option. When the client is built from a bare `Device[]` with neither source
available, `buildPrompt` throws.

`analyze(dsl)` runs `parseHomeDSL` + `validateProgram` without executing and
returns every typed error without throwing and without any retry loop — the
NL→DSL loop stays with the host:

```ts
const feedback = client.analyze('tv[unknown_room].power = on')

// {
//   program: Program | null,          // null when parsing failed
//   parseErrors: ParseErrorInfo[],    // { message, line, column }
//   validationErrors: VMError[],      // { statement, message }
//   ok: boolean,
// }
```

### `RunResult`

`execute` / `runDsl` / `resume` / `resumePending` / `cancel` / `answerSuggestion`
all return a serializable `RunResult`:

```ts
interface RunResult {
  status: 'success' | 'awaiting_interaction' | 'error'
  executed: ExecutedStatementSummary[]
  interaction: UserInteraction | null
  errors: VMError[] // { statement?, code?, message }
  suggestions?: SuggestionSummary[] // only when some are open
}

interface ExecutedStatementSummary {
  statement: Statement
  resolvedDevices: DeviceSummary[]
  changes: StateChange[]
  outcomes?: ActionOutcome[]
  filter?: ResolutionFilter
  origin?: { suggestionId: string } // follow-up entries only
}

interface SuggestionSummary {
  id: string
  question: SuggestionQuestion
  targets: DeviceSummary[] // devices the follow-up would act on
}
```

`RunResult` is a lightweight, JSON-safe projection: `resolvedDevices` and
`targets` are `DeviceSummary` objects (`id`/`type`/`room`/`name`/`owners`/`tags`)
with no live `DeviceDriver`. The full `Session` (variables, `$it`, history, …)
is not part of the result — read it via `getSession()`. Power users can still
obtain the raw `VMResult` shape from `@opennest/vm`.

- `suggestions` is present only on a `success` run that leaves follow-up
  questions open (see [Suggestions](#suggestions)).
- `origin` marks the `executed` entries produced by answering a suggestion; it
  carries the `suggestionId` whose answer ran them.

A client does not run two executions concurrently: every execution method
mutates the client's single session in place. `await` the previous call before
starting the next one; for parallel executions, use one `OpenNestClient` per
execution.

### Interaction round-trip

On `status: 'awaiting_interaction'`, read the typed `UserInteraction` and reply
with a matching `UserResponse` via `resume(response)`:

```ts
const result = await client.runDsl('$tv = @oneof(tv)')
// With ≥2 TVs in the inventory, this suspends with `awaiting_interaction`.

if (result.status === 'awaiting_interaction' && result.interaction) {
  const interaction = result.interaction // typed UserInteraction
  // e.g. { id, type: 'device_selection', message, devices }

  const resumed = await client.resume({
    interactionId: interaction.id,
    type: 'device_selection',
    deviceId: 'tv_living_room',
  })
}
```

Each `UserInteraction` (`device_selection`, `confirmation`, `text_input`,
`number_input`, `choice`, `action_parameter`) carries an `id` to copy into the
`interactionId` field of the matching `UserResponse`.

`resumePending(answer)` does the copying for you: it takes the answer without
`interactionId` and injects the id of the pending interaction. It also validates
the answer before it reaches the VM, returning an `error` `RunResult` (and
leaving the interaction pending, so you can retry) with one of these codes:

| Code                        | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `no_pending_interaction`    | Nothing is pending — execute a program first.                               |
| `interaction_type_mismatch` | The answer's `type` differs from the pending interaction's.                 |
| `unknown_device_id`         | A `device_selection` answer names a device that is not among the choices.   |
| `invalid_response`          | A `text_input` / `number_input` / `choice` answer violates its constraints. |

```ts
const resumed = await client.resumePending({
  type: 'device_selection',
  deviceId: 'tv_living_room',
})
```

`getPendingInteraction()` returns the interaction currently awaiting an answer
(or `null`).

#### `onInteraction` / `onInteractionError`

`onInteraction` is invoked whenever a run returns `awaiting_interaction` with a
non-null `interaction`, so the host can react (e.g. render a prompt) without
polling the result. It is fire-and-forget: the client never awaits it, so a
slow handler does not block execution. It may return `void` or a
`Promise<void>`. A synchronous `throw` or a promise rejection is caught and
routed to `onInteractionError(error, interaction)` when provided, otherwise
ignored; if `onInteractionError` itself throws, the exception is silently
swallowed. The callback never rejects the `RunResult`.

### Suggestions

A suggestion is a follow-up question offered **after** a successful run (for
example "which ambiance?" once lights are on), declared by VM middleware — see
the vm README's [Suggestions](../vm/README.md#suggestions). The original command
has already executed; the user may answer later, or never.

```ts
// Assumes a registered suggestion whose question is a `choice` with a `relax` option.
const result = await client.runDsl('$lights = @all(light[living_room])\n$lights.power = on')

// 1. list — also available any time via client.getSuggestions()
for (const suggestion of result.suggestions ?? []) {
  console.log(suggestion.id, suggestion.question.message, suggestion.targets)
}

// 2. answer — runs the follow-up; its executed entries carry `origin`
const first = result.suggestions?.[0]
if (first !== undefined) {
  const followUp = await client.answerSuggestion(first.id, {
    type: 'choice',
    value: 'relax',
  })
  // followUp.executed[i].origin === { suggestionId: first.id }
}

// 3. or dismiss — drops one suggestion without running anything
client.dismissSuggestion('some-id') // true if it existed
```

`answer` is a `SuggestionResponse`: `{ type: 'text_input', text }`,
`{ type: 'number_input', value }` or `{ type: 'choice', value }`. Answering
removes only that suggestion and appends the suggestions its follow-up opens.

`answerSuggestion` never throws for a bad answer; it returns an `error`
`RunResult` whose `errors[0].code` is one of:

| Code                        | Meaning                                                                                |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `suggestion_not_found`      | Unknown id: already answered, dismissed, or dropped by a newer command.                |
| `suggestion_unavailable`    | Its definition is not defined in this runtime (reported by the VM).                    |
| `interaction_pending`       | An interaction is pending: answer it with `resume` / `resumePending` or `cancel` first (reported by the VM). |
| `interaction_type_mismatch` | The answer's `type` differs from the suggestion's question type.                       |
| `invalid_response`          | The answer violates the question's constraints (`min`/`max`, `choice` options, …).     |

Every rejection leaves the suggestion open. `interaction_pending`,
`interaction_type_mismatch` and `invalid_response` can be retried (resolve the
pending interaction first for `interaction_pending`). Suggestions are dropped
when a new run starts and by `cancel()`.

## Exports

| Export                                                                     | Kind     | Description                                                      |
| -------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `OpenNestClient`                                                           | class    | The facade                                                       |
| `OpenNestClientOptions`, `OpenNestClientFromYamlOptions`, `DSLFeedback`, `ResumeAnswer` | types | Client option, `analyze` and `resumePending` types               |
| `toRunResult`                                                              | function | `VMResult` → `RunResult` projection                              |
| `RunResult`, `ExecutedStatementSummary`, `SuggestionSummary`, `DeviceSummary` | types | Result types                                                     |
| `ParseError`                                                               | class    | Thrown by `parse` / `runDsl`                                     |
| `createAsk`, `createConfirmationMiddleware`, `defineSuggestion`, `DefaultVMEventBus` | values | Re-exported from `@opennest/vm`                                  |
| `Device`, `Session`, `VMResult`, `VMError`, `VMStatus`, `UserInteraction`, `UserResponse`, `DeviceSelectionInteraction`, `Middleware`, `VMEventBus`, `VMEvent`, `ExecutedStatement`, `StateChange`, `PlannedAction`, `AskQuestion`, `AskScope`, `AskAnswer`, `AskFn`, `SuggestionQuestion`, `SuggestionAnswer`, `SuggestionApply`, `SuggestionDefinition`, `SuggestionResponse`, `JsonValue` | types | Re-exported from `@opennest/vm`                                  |
| `Program`, `ParseErrorInfo`, `PromptOptions`                               | types    | Re-exported from `@opennest/lang-core`                           |
| `DeviceRegistry`, `PromptDefinitions`                                      | types    | Re-exported from `@opennest/devices`                             |
