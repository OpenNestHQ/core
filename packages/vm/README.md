# @opennest/vm

HomeDSL interpreter — device resolution, interactions, middleware, validation, state verification and execution tracing.

The public API is Promise-based (`@opennest/vm`). An Effect entry point (`@opennest/vm/effect`) adds a cooperative stop; see [Effect API](#effect-api-opennestvmeffect).

## Install

```bash
pnpm add @opennest/vm
```

## API

### `executeCommand(command, context): Promise<VMResult>`

Single entry point. Accepts a discriminated union of commands (see [Command types](#command-types)):

```ts
import { executeCommand, createSession } from '@opennest/vm'

// Run a parsed program
const result = await executeCommand(
  { kind: 'run_program', program },
  { devices: myDevices, session: createSession() },
)

// Resume after a user interaction
const resumed = await executeCommand(
  { kind: 'resume_interaction', response },
  { devices: myDevices, session: result.session },
)

// Cancel the current execution
await executeCommand(
  { kind: 'cancel_execution' },
  { devices: myDevices, session },
)
```

Business outcomes (validation errors, blocked actions, ambiguity, a rejected resume, a device command the driver rejected) are reported in the returned `VMResult`. The promise rejects only on an infrastructure failure that aborts the run — a middleware throwing something that is not a flow-control signal, or a driver read the run depends on (such as an `@if` condition) failing — and then rejects with the **original** error thrown by the middleware or driver.

### `VMContext`

```ts
{
  devices: Device[],
  session?: Session,
  middleware?: Middleware[],
  eventBus?: VMEventBus,
}
```

`Device` is `{ id, type, room, name, driver, driverConfig, owners?, tags? }`; `driver` is a `DeviceDriver` instance from `@opennest/devices`.

### `createSession(): Session`

Creates a fresh VM session. A session carries the variables, the `$it` context (last resolved device), the history, the cursor and pending interaction of a suspended program, and the open suggestions. It persists across calls: pass `result.session` to the next command.

### `validateProgram(program, devices, session?): VMError[]`

Pre-validates a program before execution. Returns validation errors without side effects. See [Pre-execution validation](#pre-execution-validation).

### `VMResult`

```ts
{
  status: 'success' | 'awaiting_interaction' | 'error', // VMStatus
  session: Session,
  executed: ExecutedStatement[],
  interaction: UserInteraction | null,
  errors: VMError[],              // { statement?, code?, message }
  suggestions?: OpenSuggestion[], // only on 'success', when non-empty
}
```

`ExecutedStatement` is `{ statement, resolvedDevices, changes, outcomes?, filter?, origin? }`: `changes` lists the `StateChange`s (`{ deviceId, property, oldValue, newValue }`), `outcomes` the per-device [action outcomes](#state-verification), `filter` the [intent filtering](#intent-filtering-auto-disambiguation) report, and `origin` (`{ suggestionId }`) marks entries of a [suggestion](#suggestions) follow-up.

## Command types

| Command | `kind` | Fields | Description |
|---|---|---|---|
| `RunProgramCommand` | `run_program` | `program` | Execute a full parsed HomeDSL program |
| `ExecuteActionCommand` | `execute_action` | `action`, `deviceId?` | Execute a single action, optionally scoped to one device |
| `ExecuteStatementCommand` | `execute_statement` | `statement`, `deviceId?` | Execute a single statement, optionally scoped to one device |
| `ResumeInteractionCommand` | `resume_interaction` | `response` (`UserResponse`) | Resume after a user interaction |
| `CancelExecutionCommand` | `cancel_execution` | — | Cancel and return a fresh session |
| `AnswerSuggestionCommand` | `answer_suggestion` | `suggestionId`, `response` (`SuggestionResponse`) | Answer an open suggestion and run its follow-up |

`execute_action` and `execute_statement` wrap the action or statement in a one-statement program. With a `deviceId`, the context's device list is filtered to that single device.

`run_program`, `execute_action` and `execute_statement` start a new run (a new `session.programId`) and close the previous suggestions. While an interaction is pending, they are rejected with the error code `interaction_pending`: answer it with `resume_interaction`, or send `cancel_execution` first.

## User interactions

The VM uses an extensible interaction system instead of hardcoding ambiguity. When execution needs user input, it returns `status: 'awaiting_interaction'` with a typed `interaction` payload (every interaction has an `id`, a `type` and a `message`). Resume with `resume_interaction` and a `UserResponse` of the same `type`, carrying the interaction's id as `interactionId`.

| Interaction type | When | Payload (besides `id`, `message`) | Response (besides `interactionId`, `type`) |
|---|---|---|---|
| `device_selection` | Several devices match a reference | `devices: { id, name, type, room }[]` | `deviceId: string` |
| `confirmation` | A middleware requires approval (e.g. `createConfirmationMiddleware`) | — | `confirmed: boolean` |
| `text_input` | Raised by middleware, typically through `ask()` | `placeholder?` | `text: string` |
| `number_input` | Raised by middleware, typically through `ask()` | `min?`, `max?` | `value: number` |
| `choice` | Raised by middleware, typically through `ask()` | `options: { value, label }[]` | `value: string` (an option value) |
| `action_parameter` | An action is called without some of its required parameters | `deviceName`, `action`, `missing: { name, type, values? }[]` | `values: Record<string, string>` |

`action_parameter` comes from the device config: required parameters are declared in `driverConfig.actions.<name>.parameters` (`{ name, type, required, values? }`). The answer values are strings, converted by parameter type: `number` → number, `power` → `on` / `off`, `string` and `enum` → string.

Answers to `ask()` questions are validated: a `number_input` outside `min`/`max` (inclusive) or not finite, an empty `text_input` (after trimming), or a `choice` value that is not one of the options is rejected with the error code `invalid_response`. The error is retryable and the question stays pending. `checkInputAnswer(spec, response)` exposes the same check.

A rejected resume is an `error` result with nothing executed; `errors[0].code` is one of the `InteractionErrorCode`s: `no_session`, `no_pending_program`, `no_pending_interaction`, `interaction_id_mismatch`, `interaction_type_mismatch`, `unknown_device_id`, `invalid_response`.

### Intent filtering (auto-disambiguation)

When a statement targets a property or an action, the resolver filters out devices that don't support it (based on their `driverConfig`). This can disambiguate without asking the user. Each `ExecutedStatement` may include a `ResolutionFilter`:

```ts
{ candidates: number, matched: number, excluded: ExcludedDevice[] }
```

Each `ExcludedDevice` is `{ deviceId, deviceName, reason, details }`, with `reason` `'property_not_supported'` or `'action_not_supported'`.

## Middleware

Middleware forms a composable Koa-style `(ctx, next)` pipeline between statement resolution and device execution. Each `(device, operation)` pair — a `PlannedAction` (`set_property`, `increment_property`, `read_property` or `invoke_action`) — passes through the ordered chain before dispatch. `ctx` is `{ action, session, devices }`; a middleware returns a `Promise<PipelineOutcome>` (`execute`, `blocked`, `skipped` or `paused`). Add `middleware` to `VMContext`:

```ts
import { createConfirmationMiddleware, executeCommand } from '@opennest/vm'

const confirmVacuum = createConfirmationMiddleware({
  requireConfirmation: action =>
    action.kind === 'invoke_action' && action.method === 'start',
  message: () => 'Start the vacuum?', // optional, a default message is generated
})

const result = await executeCommand(
  { kind: 'run_program', program },
  { devices, session, middleware: [confirmVacuum] },
)
```

### Built-in middleware

| Middleware | Behavior |
|---|---|
| `noopMiddleware` | Always calls `next()` — template/skeleton |
| `createConfirmationMiddleware({ requireConfirmation, message? })` | Pauses for a `confirmation` on matching actions; a denial blocks the action |

### Flow control

Throw a signal:

- **`BlockSignal(reason)`** — reject the action
- **`SkipSignal(reason?)`** — skip it silently
- **`PauseSignal(interaction, context?)`** — suspend for a user interaction
- **`ExpandSignal(actions[])`** — split it into several actions

Or return an outcome instead of throwing: `block(reason)`, `skip(reason?)` and `pause(interaction, context?)` build the matching `PipelineOutcome`. `expand` has no return-based helper: use `ExpandSignal`.

To **replace** an action, mutate `ctx.action` and `await next()`.

```ts
import { block, type Middleware } from '@opennest/vm'

const noBathroomSpeaker: Middleware = async (ctx, next) => {
  if (
    ctx.action.device.type === 'speaker' &&
    ctx.action.device.room === 'salle_de_bain'
  ) {
    return block('Speakers are disabled in the bathroom')
  }
  return next()
}
```

A middleware that throws anything other than a signal makes `executeCommand` reject with that error.

### Asking questions with `ask()`

`createAsk()` returns a synchronous `ask(ctx, question)` that either returns the answer or pauses the run with a `text_input`, `number_input` or `choice` interaction. After the user answers, the pipeline is replayed and `ask` returns the answer; the device command is never sent before it.

```ts
import { createAsk, type Middleware } from '@opennest/vm'

const ask = createAsk()

const askTemperature: Middleware = (ctx, next) => {
  if (
    ctx.action.kind === 'set_property' &&
    ctx.action.device.type === 'thermostat' &&
    ctx.action.property === 'temperature'
  ) {
    const value = ask(ctx, {
      key: 'temperature',
      type: 'number_input',
      message: 'Quelle température ?',
      min: 10,
      max: 30,
    })
    ctx.action.value = { kind: 'number', value }
  }
  return next()
}
```

- `scope`: `'device'` (default) asks once per device, so `@all(...)` asks one question per device; `'statement'` asks once per statement.
- Answers live for the current program run only and never leak into a later run. Each `createAsk()` has its own store, and one `ask` can be shared by several sessions.
- Invalid questions (empty `key`, a `choice` without options or with duplicate option values, a non-finite `min`/`max`, `min > max`) throw a plain `Error`.
- Known limitation: statements nested in one `@if` share a statement index, so two nested actions on the same device asking the same `key` share one answer.

### Suggestions

A suggestion is a follow-up question offered **after** a successful run (for example "which ambiance?" once lights are on). Unlike `ask()`, it never blocks the run: the original command executes first, and the user may answer later.

Declare the suggestion once with `defineSuggestion(name, { apply })`, then call `.suggest(ctx, question)` from a middleware. `apply(answer, devices, data)` receives the answer, the targeted devices and the optional JSON `data`, and returns the `PlannedAction[]` to run.

```ts
import { defineSuggestion, type Middleware } from '@opennest/vm'

const ambiance = defineSuggestion('home.ambiance', {
  apply: (answer, devices) =>
    devices.map(device => ({
      kind: 'set_property',
      device,
      property: 'brightness',
      value: { kind: 'number', value: answer === 'cinema' ? 20 : 80 },
    })),
})

const suggestAmbiance: Middleware = (ctx, next) => {
  if (
    ctx.action.kind === 'set_property' &&
    ctx.action.property === 'power' &&
    ctx.action.value.kind === 'power' &&
    ctx.action.value.value === 'on'
  ) {
    ambiance.suggest(ctx, {
      key: 'ambiance',
      type: 'choice',
      message: 'Which ambiance?',
      options: [
        { value: 'cinema', label: 'Cinema' },
        { value: 'reading', label: 'Reading' },
      ],
      data: { source: 'power' }, // optional, JSON only
    })
  }
  return next()
}
```

- **`apply`**: may be async. Returning `[]` is a valid no-op (the answer succeeds with nothing executed). Equal operations on different devices run as one step; the same operation twice on one device stays two steps and both execute. `apply` must not return `read_property` actions or actions on devices missing from the context; `apply` throwing (or returning such actions) makes `executeCommand` reject.
- **Follow-up checks**: a follow-up skips static validation and intent filtering, so `apply` must return actions the devices support; failures show up as device failures. A follow-up that ends in `error` opens no suggestions.
- **Questions**: `text_input`, `number_input` and `choice`, validated like `ask()` answers (an invalid question throws, with a `suggest():` message prefix).
- **Targets**: only devices whose action was accepted by the driver are targeted; if none were, no suggestion opens. One suggestion per statement and `key`.
- **Lifetime**: suggestions open only when the run ends in `success` (`result.suggestions` lists all open ones, `session.suggestions` stores them as plain JSON with device ids). Once the open set is empty, `session.suggestions` is removed. They are cleared when a new `run_program` / `execute_action` / `execute_statement` starts and by `cancel_execution`. Answering one removes only that one and appends the suggestions of its follow-up.
- **Answering**: `executeCommand({ kind: 'answer_suggestion', suggestionId, response }, ctx)` with `response` = `{ type: 'text_input', text }`, `{ type: 'number_input', value }` or `{ type: 'choice', value }`. The follow-up runs through the middleware pipeline (it may pause and resume) and its executed entries carry `origin: { suggestionId }`.
- **Error codes**: `suggestion_not_found` (unknown, answered or dropped id), `suggestion_unavailable` (its definition is not defined in this runtime), plus `interaction_pending`, `interaction_type_mismatch` and `invalid_response` (retryable; the suggestion stays open).
- **Registry**: definitions are registered by name, process-wide. Redefining a name with the same `apply` returns the same definition; with a different `apply` it throws. The session stores only the name, so a suggestion survives serialization as long as the name is defined when answered.

## Pre-execution validation

`validateProgram(program, devices, session?)` statically checks every statement before execution and returns `VMError[]` — no side effects. It collects all errors in one pass and checks that:

- device types and rooms exist in the inventory;
- properties and actions are supported by the target devices;
- `$it` is set before use;
- `$variables` are defined before reference;
- `@if` conditions don't contain ambiguous device references (except `@oneof` variables);
- both `@if` and `@else` branches are valid.

The interpreter runs it automatically at the start of a fresh execution (`session.cursor === 0`); a program with validation errors is not executed. Suggestion follow-ups skip it.

## State verification

After each write, the VM checks whether the device reached the expected state, and records the result as an `ActionOutcome` per device in `ExecutedStatement.outcomes`:

```ts
{
  deviceId: string,
  execution: { status: 'accepted' | 'failed', error? }, // did the driver accept the write?
  verification: { status, expected?, observed? },       // did the state converge?
}
```

**Expected state.** For `set_property` and `increment_property`, the expected state is the new property value. For `invoke_action`, it comes from the device config, `driverConfig.actions.<name>.expectedEffects` (property → value); an action without `expectedEffects` is `not_observable`. Reads produce no outcome.

**Strategy.** The driver chooses how to observe through its optional `getVerificationStrategy()`:

| Strategy | Behavior |
|---|---|
| `{ type: 'poll', timeout, interval }` | Reads every `interval` ms until the state matches or `timeout` ms have passed |
| `{ type: 'event', timeout }` | Reads once, then subscribes through the driver's `subscribeProperty()` and re-reads on each notification until match or `timeout`; with no subscription, the single read decides |
| none (`null` / method absent) | One immediate read |

`DEFAULT_POLL_TIMEOUT_MS` (2000) and `DEFAULT_POLL_INTERVAL_MS` (200) are exported as defaults drivers can use for a `poll` strategy.

**Verification statuses:**

| Status | Meaning |
|---|---|
| `confirmed` | The observed state matches the expected one |
| `mismatch` | A single observation (no strategy, or `event` without subscription) does not match |
| `timeout` | The `poll` / `event` deadline passed before the state matched |
| `not_observable` | Nothing to verify (no `expectedEffects`), or the verification failed (e.g. a read error) |

A verification never fails the action: `execution` and `verification` are reported separately. A command the driver rejected is `execution: { status: 'failed', error }` with `verification: { status: 'not_observable' }`.

## Execution tracing

Opt-in deterministic trace via `eventBus`: the VM emits typed `VMEvent`s, and a tracer builds a tree of `ExecutionNode`s.

```ts
import {
  DefaultExecutionTracer,
  DefaultVMEventBus,
  executeCommand,
} from '@opennest/vm'

const tracer = new DefaultExecutionTracer()
const eventBus = new DefaultVMEventBus(tracer) // feeds every event to the tracer

const result = await executeCommand(
  { kind: 'run_program', program },
  { devices, session, eventBus },
)

const trace = tracer.getTrace() // { root: ExecutionNode }
```

Other listeners can be added with `eventBus.subscribe(event => …)`, which returns an unsubscribe function.

### Node kinds

| `NodeKind` | What |
|---|---|
| `Program` | Root — one per command |
| `Statement` | One per DSL statement; `@if` bodies appear as children |
| `Handler` | Interaction handler execution (device selection, confirmation, …) |
| `Middleware` | Middleware evaluation per `PlannedAction` |
| `Execute` | `setProperty` / `readProperty` / `incrementProperty` / `invokeAction` calls |

Each node records `id`, `parentId`, `kind`, `name`, `status`, `startedAt`, `endedAt`, `duration`, `children` and arbitrary `attributes`. `NodeStatus` is `Running`, `Success`, `Failed`, `Waiting`, `Skipped` or `Interrupted` (only for runs stopped through [`@opennest/vm/effect`](#effect-api-opennestvmeffect)).

To export traces to OpenTelemetry, see [`@opennest/vm-opentelemetry`](../vm-opentelemetry).

## Effect API (@opennest/vm/effect)

The Promise API above is the default. Effect is an internal implementation detail of the VM; the `@opennest/vm/effect` entry point exposes it for callers that use [Effect](https://effect.website) and need a **cooperative stop**.

Exports: `runCommand`, `DriverError`, `MiddlewareError`, and the types `RunOptions`, `EffectVMResult`, `EffectVMStatus`, `VMInfraError`.

### `runCommand(command, context, options?): Effect<EffectVMResult, VMInfraError>`

Same commands and context as `executeCommand`. Business outcomes stay in the result; only infrastructure failures are in the error channel, as tagged errors: `DriverError { deviceId, operation: 'get' | 'set' | 'action', cause }` and `MiddlewareError { middlewareName, cause }` (`cause` is the original error).

```ts
import { Effect } from 'effect'
import { runCommand } from '@opennest/vm/effect'

const result = await Effect.runPromise(
  runCommand(
    { kind: 'run_program', program },
    { devices, session },
    { stop: Effect.sleep('5 seconds') }, // request a stop after 5 s
  ),
)

if (result.status === 'interrupted') {
  console.log(`${result.completedStatements} statements completed`)
}
```

### Cooperative stop

`RunOptions.stop` is an `Effect<void>`; the stop is requested when it completes.

- The VM checks the stop before each statement and before each write: nothing new is sent.
- A write already sent runs to completion (its driver promise is awaited).
- Reads and verifications are abandoned; an action sent before the stop reports `verification: not_observable`.
- The result has `status: 'interrupted'` (`EffectVMStatus` = `VMResult['status'] | 'interrupted'`), `completedStatements` (top-level statements finished) and `executed` (the history so far).
- The session is reset (`cursor = 0`, no pending program or interaction) but keeps its `history`, `it` and variables.
- A stop has no effect once the run has ended, including on `awaiting_interaction`.

`executeCommand` never stops: `'interrupted'` is not part of `VMResult['status']`. Only `RunOptions.stop` yields a consistent partial result; interrupting the `runCommand` fiber directly leaves trace nodes `Running` and the session mid-program.

## Key features

- **User interactions** — extensible typed interaction system (not just ambiguity)
- **Intent filtering** — auto-excludes devices that don't support targeted properties/actions
- **Stateful sessions** — variables, `$it` context, and history persist across calls
- **Collections** — `@all`, `@first` with batch execution
- **Conditions** — `@if`/`@else`/`@endif` with `&` (AND) and `|` (OR)
- **Pre-validation** — static program validation before execution
- **Middleware** — composable chain for confirmation, blocking, skipping, expansion, questions and suggestions
- **State verification** — per-action outcome separating execution from state convergence
- **Execution tracing** — deterministic event-bus-based trace tree
- **Cooperative stop** — via `@opennest/vm/effect`
