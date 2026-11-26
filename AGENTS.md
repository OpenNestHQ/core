# AGENTS.md

## Project

OpenNest (also called ClawNest) — a DSL runtime for smart environments: HomeDSL → parser → VM interpreter.

The pipeline: **Natural Language → HomeAgent (LLM) → HomeDSL → VM (`executeCommand`) → Devices.**

No root `src/` — all code lives in `packages/`. Monorepo managed with **pnpm workspaces** (`pnpm-workspace.yaml` + root `package.json`).

## Package map

| Package | npm name | Role | Depends on |
|---|---|---|---|
| `packages/lang-core` | `@opennest/lang-core` | Parser (HomeDSL → AST), prompt generator, AST builders | *none* |
| `packages/devices` | `@opennest/devices` | Device registry, `DeviceDriver` interface, mock + HA drivers | `lang-core` (types only) (+ `js-yaml`, `effect`) |
| `packages/vm` | `@opennest/vm` | interpreter: `executeCommand()`, resolution, middleware, interactions, validation, tracing, verification; also `@opennest/vm/effect` | `lang-core`, `devices` (+ `effect`) |
| `packages/vm-opentelemetry` | `@opennest/vm-opentelemetry` | OpenTelemetry trace sink for the VM `ExecutionTrace` | `@opentelemetry/api` (peer: `vm`, types only) |
| `packages/sdk` | `@opennest/sdk` | Deterministic execution facade (`OpenNestClient`) over parser + devices + VM | `lang-core`, `devices`, `vm` |
| `packages/mcp` | `@opennest/mcp` | Stdio MCP server exposing the runtime (HomeDSL execution, interactions, suggestions, session) to AI agents | `sdk`, `vm`, `devices` |
| `examples/playground` | `@opennest/playground` | Interactive TUI/REPL demo with 14 mock devices | `sdk` |

Cross-package deps use `"workspace:*"` in package.json (`"workspace:^"` for peer dependencies), resolved by pnpm.

## Commands

Run from the repo root with `pnpm`:

```bash
pnpm install            # Install all dependencies (root + all packages)

# Build all packages (pnpm respects topological order automatically)
pnpm run build

# Build a single package
pnpm --filter @opennest/devices run build

# Test all packages
pnpm run test

# Test a single package
pnpm --filter @opennest/vm run test

# Test all packages with coverage (what CI runs; config: vitest.coverage.config.ts)
pnpm run test:coverage

# Check that the packages can be released: build, manifests, tarball contents,
# then install the tarballs outside the repo and use them (needs the npm registry)
pnpm run release:check

# Regenerate packages/lang-core/example-prompt.md
pnpm run build:prompt

# Run playground REPL
pnpm run start

# Lint (ESLint) — examples/ + packages/
pnpm run lint

# Format (Prettier, write)
pnpm run format

# Format check (Prettier, no write)
pnpm run format:check
```

You can also run commands per-package with `cd` and `pnpm run <script>` as usual.

## Build order

pnpm handles topological ordering automatically. The dependency graph is:

1. `lang-core` — no cross-package deps.
2. `devices` — depends on `lang-core` (types only).
3. `vm` — depends on both `devices` + `lang-core`.
4. `sdk` — depends on `lang-core` + `devices` + `vm`.
5. `mcp` — depends on `sdk` + `vm` + `devices`; nothing depends on it.
6. `examples/playground` (TUI) and `examples/web-playground` — depend on `sdk`.
7. `lang-core`'s `build:prompt` requires `dist/` to exist, so `build` must run first.

## Module system

All packages are **ESM-only** (`"type": "module"`) using **nodenext** module resolution.

**All relative TS imports must end with `.js`** (e.g. `import { foo } from "./bar.js"`), not `.ts`. This is required by nodenext and `verbatimModuleSyntax`. Failing to use `.js` extensions will cause build errors.

Use `import type { ... }` for type-only imports — required by `verbatimModuleSyntax: true`.

`@opennest/vm` has two entry points (`exports` in its package.json): `@opennest/vm` (Promise API) and `@opennest/vm/effect` (Effect API, see "Effect core"). The `effect` dependency (pinned `~4.1.5`, because the HA client's sync-send invariant relies on 4.1.5 internals) exists in `packages/devices` and `packages/vm` **only** — `lang-core`, `sdk`, `mcp` and `examples/*` must not depend on it.

## TypeScript config

All packages share the same strict tsconfig:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "esnext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedSideEffectImports": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

Key flags:
- `verbatimModuleSyntax: true` → `import type` for type-only imports, no implicit type re-exports.
- `noUncheckedIndexedAccess: true` → all index accesses return `| undefined`.
- `exactOptionalPropertyTypes: true` → `undefined` is not assignable to optional properties.
- `moduleDetection: "force"` → every `.ts` file is treated as a module (no global scripts).

## Testing

- **vitest** v4, no config file — infers from `"type": "module"` in package.json.
- Test files sit alongside source: `src/**/*.test.ts`.
- Run all tests: `pnpm run test` (from the package directory).
- Run a single file: `pnpm exec vitest run path/to/file.test.ts` (from the package directory).
- **playground has no tests.**
- `sdk` is covered by `client.test.ts` (end-to-end via `MockDriver`).
- `vm-opentelemetry` has its own tests (`normalizer.test.ts`, `OpenTelemetryTraceSink.test.ts`).
- `vm` tests create devices inline with `MockDriver` + `seed()`. No external fixture files are required at runtime. `packages/vm/__fixtures__/inventory.yaml` is a sample inventory (7 devices, English rooms) used e.g. by the MCP README to run the server; the vm tests don't need it.
- `devices` tests use temporary YAML files in `/tmp/` for registry tests. `homeassistant.test.ts` uses `vi.stubGlobal("fetch", ...)` to mock HTTP calls.

## Architecture notes

### Entry points

- **VM**: `executeCommand(command: VMCommand, context: VMContext) → Promise<VMResult>` in `packages/vm/src/commands/dispatch.ts`. Single Promise entry point, a façade over `runCommand` (see "Effect core"). Delegates to the interpreter for `run_program`, handles `resume_interaction` (resume the suspended program), `answer_suggestion` (run the follow-up of an open suggestion, `suggestions/answer.ts`) and `cancel_execution` (reset the session) directly.
- **VM (Effect)**: `runCommand(command, context, options?: RunOptions) → Effect<EffectVMResult, VMInfraError>`, exported from `@opennest/vm/effect`.
- **Parser**: `parseHomeDSL(source: string) → ParseResult` in `packages/lang-core/src/parser/parser.ts`.
- **Prompt**: `new OpenNestPrompt(devices, rooms, owners?, tags?).prompt(options?)` in `packages/lang-core/src/prompt/generator.ts` (defaults: `DEFAULT_DEVICES`, `DEFAULT_ROOMS`, `DEFAULT_OWNERS`, `DEFAULT_TAGS`). `OpenNestClient.buildPrompt()` wraps it.
- **Registry**: `DeviceRegistry.fromYaml(path: string)` (reads the inventory from a YAML **file path**) in `packages/devices/src/registry.ts`.
- **AST Builders**: `buildProgram()`, `buildAction()`, `buildAssignment()`, `buildQuery()`, `buildIncrement()`, `buildRoomSelector()`, `buildOwnerSelector()`, `buildTagSelector()` in `packages/lang-core/src/ast/builders.ts`.
- **SDK**: `OpenNestClient` in `packages/sdk/src/client.ts` — high-level facade (`parse`/`execute`/`runDsl`/`resume`/`cancel`/`getSession`) + `buildPrompt` + `analyze`. See `packages/sdk/README.md` for the full surface.

### VMCommand layer

`executeCommand` accepts a discriminated union of 6 commands:

| Command | `kind` | Purpose |
|---|---|---|
| `RunProgramCommand` | `"run_program"` | Execute a full parsed HomeDSL `Program` |
| `ExecuteActionCommand` | `"execute_action"` | Execute a single action, optionally scoped to `deviceId` |
| `ExecuteStatementCommand` | `"execute_statement"` | Execute a single statement, optionally scoped to `deviceId` |
| `ResumeInteractionCommand` | `"resume_interaction"` | Resume after a user interaction with `UserResponse` |
| `CancelExecutionCommand` | `"cancel_execution"` | Cancel and reset session to empty |
| `AnswerSuggestionCommand` | `"answer_suggestion"` | Answer an open follow-up suggestion (`suggestionId`, `response`) |

Commands `execute_action` and `execute_statement` build a `Program` internally via the AST builders from `lang-core`. When a `deviceId` is provided, the context's device list is filtered to that single device (scoped execution).

### VM context types

- `VMContext = { devices: Device[], session?: Session, middleware?: Middleware[], eventBus?: VMEventBus }`. Devices embed a `DeviceDriver` instance, not a driver name.
- `Device` = `{ id, type, room, name, owners?, tags?, driver: DeviceDriver, driverConfig }`.
- `DeviceDriver` (in `packages/devices/src/drivers/interface.ts`) exposes: `name`, `init()`, `getProperty()`, `setProperty()`, `executeAction()`. The `getProperty()`, `setProperty()`, and `executeAction()` methods each accept an optional trailing `runtime?: DriverRuntimeContext` argument (`{ programId: string, signal?: AbortSignal }`) identifying the current program run. `signal` aborts reads at any time; a write already sent is never aborted (the signal is only checked before sending). Optional methods: `whenReady()`, `validateDeviceConfig()`, `getVerificationStrategy()`, `subscribeProperty()` (see "State verification").
- `Session` carries: `programId` (stable per program run), `variables`, `argVariables` (named action-argument bundles), `it`, `history`, `cursor`, `resolvedIds`, `variableResolvedIds`, `variableModifiers`, `pendingInteraction`, `_pendingProgram`, and the optional `suggestions` (open follow-up suggestions, plain JSON), `_suggestionCandidates` (internal: suggestions being collected during a run) and `_pendingFollowUp` (internal: a suspended follow-up run).

### VMResult

```typescript
{ status: "success" | "awaiting_interaction" | "error",
  session: Session,
  executed: ExecutedStatement[],
  interaction: UserInteraction | null,
  errors: VMError[],
  suggestions?: OpenSuggestion[] }  // only on success, when non-empty
```

### Effect core

Effect v4 (`effect@~4.1.5`) is an **internal** implementation detail of `devices` and `vm`. The public API stays Promise-based: `executeCommand`, `DeviceDriver`, `Middleware`, `VMEventBus` are unchanged, and drivers/middleware written with plain Promises keep working.

- **Façades**: Promise functions (`executeCommand`, `verifyState`, `observeState`, `executePlannedAction`, `runMiddlewarePipeline`...) wrap `...Effect` twins. They run through `runPromiseRethrowingOriginal` (`packages/vm/src/effect/run.ts`): a rejection carries the **original error instance** thrown by the driver/middleware (not the wrapper), so `instanceof` and messages are preserved.
- **Typed infrastructure errors** (`packages/vm/src/effect/errors.ts`, `Data.TaggedError`): `DriverError { deviceId, operation: 'get'|'set'|'action', cause }` and `MiddlewareError { middlewareName, cause }` (a middleware threw something that is not a flow-control signal); union `VMInfraError`. They only live in the Effect error channel; **business outcomes** (blocked, skipped, ambiguity, validation errors, failed resume preconditions...) stay in `VMResult`.
- **Driver bridge** (`effect/driver.ts`): `readProperty` / `writeProperty` / `invokeAction` turn a driver Promise into an `Effect<_, DriverError>` and hand the driver an `AbortSignal` (combined with any `runtime.signal`) in `DriverRuntimeContext.signal`. Writes/actions additionally *await* the driver promise on interruption (a sent write runs to completion).
- **`@opennest/vm/effect`** (`effect/index.ts`): `runCommand`, `RunOptions`, `EffectVMResult`, `EffectVMStatus`, `DriverError`, `MiddlewareError`, `VMInfraError`. It also registers the default interaction handlers.
- **Cooperative stop**: `runCommand(command, ctx, { stop })` where `stop: Effect<void>` requests the stop when it completes (`effect/stop.ts`: `StopToken`, `makeStopToken`, `neverStop`; `StopRequested` never leaves the interpreter). Semantics: the VM checks before each statement and before each write; a write already sent runs to completion (its driver promise is awaited); reads and verifications are abandoned (a sent action then reports `verification: not_observable`); the result is `EffectVMResult` with `status: 'interrupted'` and `completedStatements` (top-level statements finished), `executed` = history so far. The session is reset (`cursor = 0`, no pending program/interaction) but keeps `history`, `it` and variables. A stop has no effect once the run ended, including on `awaiting_interaction`. `executeCommand` never stops: `'interrupted'` is not part of `VMResult['status']`. Only `RunOptions.stop` yields a consistent partial result; a raw fiber interrupt of `runCommand` leaves trace nodes `Running` and the session mid-program (`cursor` may be > 0).
- **HA websocket client** (`packages/devices/src/drivers/ha/ws-core.ts`): Effect implementation (connection-loop fiber, `Deferred`-based commands, heartbeat, backoff reconnect); `ws.ts` is the Promise façade (`HAWebSocketClient`). Typed errors in `ws-errors.ts` (`HAWsAuthError` — fatal, plain `Error` subclass —, `HAWsConnectionError`, `HAWsTimeoutError`, `HAWsCommandError`, `HAWsClosedError`, `HAWsAbortedError`). **Sync-send invariant**: a command is sent before `callService` returns and `isReady()` stays synchronous. This relies on Effect 4.1.5 internals (`runFork`/`runPromise` evaluate synchronously up to the first suspension; completing a `Deferred` resumes waiters synchronously). Re-run `ws.test.ts` when upgrading `effect`.

### State verification

After a write, the VM can check that the device reached the expected state (`packages/vm/src/execution.ts`). Expected effects come from `driverConfig.actions.<name>.expectedEffects` (`readExpectedEffects`). The driver chooses how to observe via optional `getVerificationStrategy()` (`resolveVerificationStrategy`):

- `poll` (`{ timeout, interval }`): samples until the state matches or the deadline passes (`timeout`).
- `event`: reads once, then subscribes through the optional `subscribeProperty()` (returns an unsubscribe fn, or `null` if not subscribable) and re-reads on notifications until match or deadline. Subscriptions are scoped and released on completion/interruption. No subscription → single observation.
- `null` / absent: single immediate observation.

Verification statuses: `confirmed`, `mismatch`, `timeout`, `not_observable` (any verification failure; never fails the action).

Each sent action yields an `ActionOutcome` (`lang-core`, in `ExecutedStatement.outcomes`) that separates `execution` (`{ status: 'accepted' | 'failed' }`, did the driver accept the write) from `verification` (did the state converge). `verifyState` / `observeState` are Promise façades of `verifyStateEffect` / `observeStateEffect`.

### User interaction system (extensible)

User interactions have replaced the old hardcoded ambiguity system. The VM can suspend for any interaction type and resume generically.

Interaction types (`type` field discriminates):

| Type | Payload | Typical use |
|---|---|---|
| `device_selection` | `{ message, devices[] }` | Ambiguous device match |
| `confirmation` | `{ message }` | Middleware requires user approval |
| `text_input` | `{ message, placeholder? }` | Free-form text input |
| `number_input` | `{ message, min?, max? }` | Numeric input |
| `choice` | `{ message, options[] }` | Pick from a list |
| `action_parameter` | `{ message, deviceName, action, missing[] }` | Required action parameters are missing (declared in `driverConfig.actions.<name>.parameters`) |

Interaction handlers follow the `InteractionHandler` interface:
```typescript
interface InteractionHandler<TContext = unknown> {
  type: string;
  createInteraction(context: TContext): UserInteraction;
  processResponse(session: Session, context: TContext, response: UserResponse): void;
}
```

Handlers are registered in a global registry (`packages/vm/src/interactions/registry.ts`). Device selection is one handler among many. Adding a new interaction type requires only a new handler + registration — zero VM core changes.

The caller sends a `UserResponse` (discriminated union matching `UserInteraction`) via `executeCommand({ kind: "resume_interaction", response }, ...)` with the updated session.

### Asking questions (`ask()`)

`createAsk()` (`packages/vm/src/interactions/ask.ts`) returns an `ask(ctx, question)` function for middleware. The question is `text_input`, `number_input` or `choice` with a `key`; the first call suspends the run (`awaiting_interaction`), and once the user answers via `resume_interaction`, the replayed middleware gets the answer synchronously. Answers are stored per `programId` in an in-memory `AskStore`, and invalid answers are rejected with the retryable `invalid_response` code. Details: [`packages/vm/README.md`](packages/vm/README.md#asking-questions-with-ask).

### Follow-up suggestions

A suggestion is a follow-up question offered **after** a successful run; it never blocks the run. `defineSuggestion(name, { apply })` (`suggestions/define.ts`) registers a definition in a process-wide **by-name registry** and returns an object whose `.suggest(ctx, question)` is called from a middleware. Lifetime rule: suggestions open only when the run ends in `success` (listed in `VMResult.suggestions` and stored in `session.suggestions`), and are cleared by a new `run_program` / `execute_action` / `execute_statement` and by `cancel_execution`. Answer with `executeCommand({ kind: 'answer_suggestion', suggestionId, response }, ctx)`: the follow-up runs through the middleware pipeline (it may pause; its in-flight state is `session._pendingFollowUp`). Error codes: `suggestion_not_found`, `suggestion_unavailable` (name not defined in this runtime). The MCP server exposes this as the `answer_suggestion` tool. Details: [`packages/vm/README.md`](packages/vm/README.md#suggestions).

### Intent filtering (auto-disambiguation)

When a statement targets a property or action, the resolver filters out devices that don't support it (based on `driverConfig`). This can auto-disambiguate without user input. Filter feedback is included in `ExecutedStatement.filter` as `ResolutionFilter`:
```typescript
{ candidates: number, matched: number, excluded: ExcludedDevice[] }
```
Excluded devices report `reason: "property_not_supported" | "action_not_supported"`.

### Middleware

A composable middleware layer between statement resolution and device execution. Each `(device, operation)` PlannedAction passes through an ordered chain of `Middleware` functions before dispatch.

**Key types** (`packages/vm/src/middleware/types.ts`):

- `Middleware = (ctx: MiddlewareContext, next: () => Promise<PipelineOutcome>) => Promise<PipelineOutcome>` — Koa-style chain
- `MiddlewareContext` — the action (mutable) + session + devices passed to each middleware
- `PipelineOutcome` — final result after all middleware: `execute | blocked | skipped | paused`

Flow control via signals (throw-based):
- `BlockSignal(reason)` — reject the action
- `SkipSignal(reason?)` — skip silently
- `PauseSignal(interaction, context?)` — suspend for user interaction
- `ExpandSignal(actions[])` — split into multiple actions
- `replace` is done by mutating `ctx.action` and calling `await next()`

Built-in middleware:
- `noopMiddleware` — always calls `next()`, serves as template
- `createConfirmationMiddleware(opts)` — pauses for confirmation on matching actions (configurable predicate + message)

Return-based alternatives to throwing (`packages/vm/src/middleware/outcomes.ts`): `block(reason)`, `skip(reason?)`, `pause(interaction, context?)` return a `PipelineOutcome` directly. `expand` stays signal-only (`ExpandSignal`). A middleware that throws anything else is a `MiddlewareError` internally (rethrown as the original error by Promise façades).

`VMContext.middleware?: Middleware[]` wires middleware into execution.

### Pre-execution validation

`validateProgram(program: Program, devices: Device[], existingSession?: Session): VMError[]` in `packages/vm/src/validate.ts`.

Static check that runs before execution, no side effects:
- Device type and room existence
- Property/action capability checks via `ResolutionFilter`
- `$it` is set before use, `$variables` are defined before reference
- `@if` conditions don't contain ambiguous device references (except `@oneof` vars)
- Validates both `@if`/`@else` branches
- Collects ALL errors in one pass

Automatically called at the start of `interpretProgram()` on fresh executions (`cursor === 0`).

### Execution trace

Deterministic execution tracing via an event bus pattern. The VM emits typed `VMEvent` objects (10 event types) during execution; a `Tracer` consumes them and builds an `ExecutionNode` tree.

**Opt-in via `VMContext.eventBus?: VMEventBus`.** `program:end` status may be `'interrupted'` (only for runs stopped via `@opennest/vm/effect`), mapped to `NodeStatus.Interrupted`.

Node kinds captured: `Program`, `Statement`, `Handler`, `Middleware`, `Execute`.

Each `ExecutionNode` records: `id`, `parentId`, `kind`, `name`, `status` (Running/Success/Failed/Waiting/Skipped/Interrupted), `startedAt`, `endedAt`, `duration`, `children`, `attributes`.

```typescript
// Usage
import { DefaultVMEventBus, DefaultExecutionTracer, executeCommand } from "@opennest/vm";
const tracer = new DefaultExecutionTracer();
const eventBus = new DefaultVMEventBus(tracer); // feeds every event to the tracer
const result = await executeCommand(command, { devices, session, eventBus });
const trace = tracer.getTrace(); // { root: ExecutionNode }
// Other listeners: eventBus.subscribe(event => …) returns an unsubscribe function.
```

### Collections & wildcards

- `@all(type[room])` — expands to all matches, bypasses ambiguity, executes in batch.
- `@first(type[room])` — selects the first match.
- `[*]` wildcard room selector — matches devices in all rooms but stays subject to ambiguity (use `@all` for batch).
- Variables remember their modifier: `$lights = @all(light[living_room])` binds with `@all` semantics.

### `it` context

The last successfully resolved device is stored in `session.it`. It persists across VM calls within the same session.

### Variables (`$` prefix)

Variables MUST be prefixed with `$` in the DSL (both assignment and usage). The parser strips the `$` and sets `Segment.isVariable = true` on the first segment. The VM resolver uses `isVariable` to dispatch to variable resolution instead of checking `session.variables` at runtime.

```
$tv = tv[living_room]       # assignment — name stored as "tv"
$tv.power = on        # usage — path[0].isVariable === true
```

- `$it` is the context reference — auto-managed by the VM, cannot be reassigned (`$it = ...` is rejected).
- Room selectors on variable references (`$tv[living_room].power`) are rejected.

### Default devices & rooms

Defined in `packages/lang-core/src/prompt/defaults.ts`:
- **11 device types**: tv, light, speaker, thermostat, fan, blind, camera, vacuum, nightstand, door, switch
- **6 rooms** (English): `living_room`, `bedroom`, `kitchen`, `office`, `bathroom`, `entrance`

## Project file structure

```
vitest.coverage.config.ts  # Root vitest config used by `pnpm run test:coverage` (and CI)
packages/
  devices/
    src/
      index.ts           # Re-exports everything
      types.ts           # Device, DeviceEntry, InventoryYaml types
      registry.ts        # DeviceRegistry class (fromYaml, getDevices, etc.)
      drivers/
        interface.ts     # DeviceDriver interface, DriverRuntimeContext ({ programId, signal? })
        mock.ts          # MockDriver (in-memory property store)
        homeassistant.ts # HADriver (REST API via fetch + websocket)
        ha/
          ws-core.ts     # Effect HA websocket client (connection loop, commands, subscriptions)
          ws-errors.ts   # HAWs*Error types (HAWsAuthError, tagged errors, HAWsError union)
          ws.ts          # HAWebSocketClient — Promise façade over ws-core
          binding.ts, validate.ts, values.ts, args.ts  # HA device config binding/validation/mapping
  lang-core/
    src/
      index.ts           # Re-exports everything
      ast/
        types.ts         # Program, Statement, Expr, Value, etc.
        builders.ts      # buildProgram(), buildAction(), buildAssignment(), etc.
        index.ts         # Re-exports types + builders
      parser/
        parser.ts        # parseHomeDSL() + ParseError
      prompt/
        generator.ts     # OpenNestPrompt
        defaults.ts      # DEFAULT_DEVICES, DEFAULT_ROOMS, DEFAULT_OWNERS, DEFAULT_TAGS
        types.ts         # PromptOptions, DeviceDefinition, RoomDefinition, OwnerDefinition, TagDefinition, ...
    scripts/
      build-prompt.js    # Generates example-prompt.md
    example-prompt.md    # Generated output
  vm/
    src/
      index.ts           # Public API — re-exports everything below
      types.ts           # VMContext, VMResult, Session, Device, ResolutionFilter, etc.
      commands/
        types.ts         # VMCommand discriminated union (6 variants)
        dispatch.ts      # runCommand() (Effect, RunOptions.stop) + executeCommand() Promise façade
      effect/
        errors.ts        # DriverError, MiddlewareError, VMInfraError, toOriginalError
        driver.ts        # readProperty/writeProperty/invokeAction — driver Promise → Effect, AbortSignal
        run.ts           # runPromiseRethrowingOriginal() — façade runner
        stop.ts          # StopToken, makeStopToken, neverStop, EffectVMResult ('interrupted')
        index.ts         # Public entry point @opennest/vm/effect
      execution.ts       # State verification: strategies (poll/event), verifyState(Effect), observeState(Effect)
      interactions/
        types.ts         # UserInteraction, UserResponse, InteractionHandler, PendingInteraction
        registry.ts      # Handler registry + createInteraction()/processInteractionResponse()
        device-selection.ts # deviceSelectionHandler
        confirmation.ts  # confirmationHandler
        action-parameter.ts # actionParameterHandler (missing required action parameters)
        ask.ts           # createAsk() / AskStore — middleware questions (text_input, number_input, choice)
        input-answer.ts  # checkInputAnswer() — validates ask() answers
        input-handlers.ts # Handlers for text_input / number_input / choice
        register-defaults.ts # Registers the default interaction handlers
        errors.ts        # InteractionError, InteractionErrorCode
        index.ts         # Re-exports + auto-registration of handlers
      suggestions/
        define.ts        # defineSuggestion() — named suggestion + suggest()
        registry.ts      # By-name suggestion registry
        collect.ts       # Candidate collection / open-suggestion bookkeeping
        answer.ts        # answer_suggestion command handling
        follow-up.ts     # Follow-up steps and run (middleware-gated)
        types.ts         # OpenSuggestion, SuggestionResponse, FollowUpStep, ...
      middleware/
        types.ts         # Middleware, PlannedAction, PipelineOutcome, signals
        pipeline.ts       # runMiddlewarePipeline() — sequential chain evaluator
        noop.ts           # noopMiddleware
        outcomes.ts       # block()/skip()/pause() return-based outcome helpers
        confirmation.ts   # createConfirmationMiddleware() — pause-and-resume
      trace/
        types.ts         # ExecutionNode, ExecutionTrace, NodeKind, NodeStatus
        events.ts        # VMEvent discriminated union (10 event types)
        event-bus.ts     # VMEventBus interface + DefaultVMEventBus
        tracer.ts        # ExecutionTracer interface + DefaultExecutionTracer
        index.ts         # Re-exports everything
      interpreter.ts     # interpretProgram()/interpretProgramEffect() — main execution loop (stop-aware)
      executor.ts        # executeAssignment, executeIncrement, executeQuery, executePlannedAction
      resolver.ts        # resolveDevices(), resolveDeviceById(), resolveByDeviceId()
      state.ts           # createSession(), resumeAndContinue()
      collections.ts     # expandCollection(), selectFirst(), selectAll()
      validate.ts        # validateProgram() — pre-execution static validation
    __fixtures__/
      inventory.yaml     # Sample YAML inventory (7 devices)
  vm-opentelemetry/
    src/
      OpenTelemetryTraceSink.ts # Exports an ExecutionTrace as OpenTelemetry spans
      normalizer.ts, events.ts, index.ts
  sdk/
    src/
      index.ts           # Re-exports (OpenNestClient + types)
      client.ts          # OpenNestClient facade (parse/execute/runDsl/resume/cancel/getSession)
      client.test.ts     # vitest tests (e2e via MockDriver)
  mcp/
    src/
      index.ts           # Public API — createOpenNestServer, createGuardedRuntime, types
      cli.ts             # stdio entry point (bin): loads inventory, connects transport, clean shutdown
      server.ts          # createOpenNestServer() — registers tools/resources, single-flight queue
      tools.ts           # run_dsl / respond / answer_suggestion / cancel / get_session handlers
      runtime.ts         # createGuardedRuntime() — pending guard, retry budget, executed scoping
      result.ts          # ToolResult envelope, InteractionPrompt projection, deviceFailures
      session.ts         # toSessionSummary() — sanitized session projection
      schemas.ts         # zod input schemas for the tools
      instructions.ts    # buildInstructions() — handshake instructions + DSL reference
examples/
  playground/
    src/
      index.ts           # main(): creates devices, starts REPL
      devices.ts         # createPlaygroundRegistry() — 14 mock devices
      repl.ts            # startRepl() — readline-based interactive loop (handles all 6 interaction types)
      format.ts          # Colored output formatting
  web-playground/
    lib/vm/              # VM adapter + device fixtures
    hooks/               # use-vm() React context + reducer
```

## Language

Everything tracked in the repo is in English: code, comments, identifiers, test data and fixtures (rooms, device ids and names), example UI text and messages, docs. Don't create French fixtures or text; use the default English rooms from `packages/lang-core/src/prompt/defaults.ts` (`living_room`, `bedroom`, `kitchen`, `office`, `bathroom`, `entrance`).

## Linting & formatting

- **ESLint** — flat config at repo root `eslint.config.js`: `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-config-prettier` (disables style rules that conflict with Prettier). ESLint covers correctness only; formatting is Prettier's job.
- **Prettier** — config at `.prettierrc.json`: `semi: false`, `singleQuote: true`, `arrowParens: avoid`. Write code matching this style (no semicolons, single quotes) so `format` doesn't churn.
- `lint` targets `examples/` + `packages/`; `format`/`format:check` target `(examples|packages)/**/*.+(js|ts|json|tsx)`.
- CI (`.github/workflows/ci.yml`) runs on PRs and pushes to `main`/`develop`: install, lint, format check, build, tests with coverage (`pnpm run test:coverage`), a coverage report (PR comment when the OpenNest GitHub App is configured, Job Summary otherwise) and a check that the generated prompt is up to date. There are no pre-commit hooks — run `pnpm run lint` and `pnpm run format:check` locally.

## Generated files (do not edit)

- `example-prompt.md` in `packages/lang-core/` — generated by `pnpm run build:prompt`.
- `dist/` in each package — generated by `pnpm run build`.
