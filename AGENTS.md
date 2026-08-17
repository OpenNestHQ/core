# AGENTS.md

## Project

OpenNest (also called ClawNest) — a DSL runtime for smart environments: HomeDSL → parser → VM interpreter.

The pipeline: **Natural Language → HomeAgent (LLM) → HomeDSL → VM (`executeCommand`) → Devices.**

No root `src/` — all code lives in `packages/`. Monorepo managed with **pnpm workspaces** (`pnpm-workspace.yaml` + root `package.json`).

## Package map

| Package | npm name | Role | Depends on |
|---|---|---|---|
| `packages/lang-core` | `@opennest/lang-core` | Parser (HomeDSL → AST), prompt generator, AST builders | *none* |
| `packages/devices` | `@opennest/devices` | Device registry, `DeviceDriver` interface, mock + HA drivers | *none* (only `js-yaml`) |
| `packages/vm` | `@opennest/vm` | interpreter: `executeCommand()`, resolution, middleware, interactions, validation, tracing | `lang-core`, `devices` |
| `packages/sdk` | `@opennest/sdk` | Deterministic execution facade (`OpenNestClient`) over parser + devices + VM | `lang-core`, `devices`, `vm` |
| `packages/playground` | `@opennest/playground` | Interactive TUI/REPL demo with 14 mock devices | `lang-core`, `devices`, `vm` |

Cross-package deps use `"workspace:*"` in package.json, resolved by pnpm.

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

# Generate HomeAgent prompt markdown
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

1. `devices` and `lang-core` — no cross-package deps, build independently (parallel-safe).
2. `vm` — depends on both `devices` + `lang-core`.
3. `sdk` — depends on `lang-core` + `devices` + `vm`.
4. `playground` — depends on `devices` + `lang-core` + `vm`.
5. `lang-core`'s `build:prompt` requires `dist/` to exist, so `build` must run first.

## Module system

All packages are **ESM-only** (`"type": "module"`) using **nodenext** module resolution.

**All relative TS imports must end with `.js`** (e.g. `import { foo } from "./bar.js"`), not `.ts`. This is required by nodenext and `verbatimModuleSyntax`. Failing to use `.js` extensions will cause build errors.

Use `import type { ... }` for type-only imports — required by `verbatimModuleSyntax: true`.

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
- `vm` tests create devices inline with `MockDriver` + `seed()`. No external fixture files are required at runtime. An `__fixtures__/inventory.yaml` exists for reference (7 sample devices).
- `devices` tests use temporary YAML files in `/tmp/` for registry tests. `homeassistant.test.ts` uses `vi.stubGlobal("fetch", ...)` to mock HTTP calls.

## Architecture notes

### Entry points

- **VM**: `executeCommand(command: VMCommand, context: VMContext) → Promise<VMResult>` in `packages/vm/src/commands/dispatch.ts`. Single entry point, delegates to `interpretProgram()` for `run_program`, handles `resume_interaction` and `cancel_execution` directly.
- **Parser**: `parseHomeDSL(source: string) → ParseResult` in `packages/lang-core/src/parser/parser.ts`.
- **Prompt**: `generateHomeAgentPrompt(config?: PromptConfig) → string` in `packages/lang-core/src/prompt/generator.ts`.
- **Registry**: `DeviceRegistry.fromYaml(yaml: string)` in `packages/devices/src/registry.ts`.
- **AST Builders**: `buildProgram()`, `buildAction()`, `buildAssignment()`, `buildQuery()`, `buildIncrement()`, `buildRoomSelector()` in `packages/lang-core/src/ast/builders.ts`.
- **SDK**: `OpenNestClient` in `packages/sdk/src/client.ts` — high-level facade (`parse`/`execute`/`runDsl`/`resume`/`cancel`/`getSession`) + `buildPrompt` + `analyze`. See `packages/sdk/README.md` for the full surface.

### VMCommand layer

`executeCommand` accepts a discriminated union of 5 commands:

| Command | `kind` | Purpose |
|---|---|---|
| `RunProgramCommand` | `"run_program"` | Execute a full parsed HomeDSL `Program` |
| `ExecuteActionCommand` | `"execute_action"` | Execute a single action, optionally scoped to `deviceId` |
| `ExecuteStatementCommand` | `"execute_statement"` | Execute a single statement, optionally scoped to `deviceId` |
| `ResumeInteractionCommand` | `"resume_interaction"` | Resume after a user interaction with `UserResponse` |
| `CancelExecutionCommand` | `"cancel_execution"` | Cancel and reset session to empty |

Commands `execute_action` and `execute_statement` build a `Program` internally via the AST builders from `lang-core`. When a `deviceId` is provided, the context's device list is filtered to that single device (scoped execution).

### VM context types

- `VMContext = { devices: Device[], session?: Session, middleware?: Middleware[], eventBus?: VMEventBus }`. Devices embed a `DeviceDriver` instance, not a driver name.
- `Device` = `{ id, type, room, name, driver: DeviceDriver, driverConfig }`.
- `DeviceDriver` (in `packages/devices/src/drivers/interface.ts`) exposes: `name`, `init()`, `getProperty()`, `setProperty()`, `executeAction()`. The `getProperty()`, `setProperty()`, and `executeAction()` methods each accept an optional trailing `runtime?: DriverRuntimeContext` argument (`{ programId: string }`) identifying the current program run.
- `Session` carries: `programId` (stable per program run), `variables`, `argVariables` (named action-argument bundles), `it`, `history`, `cursor`, `resolvedIds`, `variableResolvedIds`, `variableModifiers`, `pendingInteraction`, `_pendingProgram`.

### VMResult

```typescript
{ status: "success" | "awaiting_interaction" | "error",
  session: Session,
  executed: ExecutedStatement[],
  interaction: UserInteraction | null,
  errors: VMError[] }
```

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

**Opt-in via `VMContext.eventBus?: VMEventBus`.**

Node kinds captured: `Program`, `Statement`, `Handler`, `Middleware`, `Execute`.

Each `ExecutionNode` records: `id`, `parentId`, `kind`, `name`, `status` (Running/Success/Failed/Waiting/Skipped), `startedAt`, `endedAt`, `duration`, `children`, `attributes`.

```typescript
// Usage
import { DefaultVMEventBus, DefaultExecutionTracer } from "@opennest/vm";
const eventBus = new DefaultVMEventBus();
const tracer = new DefaultExecutionTracer();
eventBus.on(tracer.consume.bind(tracer));
const result = await executeCommand(command, { devices, session, eventBus });
const trace: ExecutionTrace = tracer.getTrace(); // { root: ExecutionNode }
```

### Collections & wildcards

- `@all(type[room])` — expands to all matches, bypasses ambiguity, executes in batch.
- `@first(type[room])` — selects the first match.
- `[*]` wildcard room selector — matches devices in all rooms, bypasses ambiguity.
- Variables remember their modifier: `$lights = @all(light[salon])` binds with `@all` semantics.

### `it` context

The last successfully resolved device is stored in `session.it`. It persists across VM calls within the same session.

### Variables (`$` prefix)

Variables MUST be prefixed with `$` in the DSL (both assignment and usage). The parser strips the `$` and sets `Segment.isVariable = true` on the first segment. The VM resolver uses `isVariable` to dispatch to variable resolution instead of checking `session.variables` at runtime.

```
$tv = tv[salon]       # assignment — name stored as "tv"
$tv.power = on        # usage — path[0].isVariable === true
```

- `$it` is the context reference — auto-managed by the VM, cannot be reassigned (`$it = ...` is rejected).
- Room selectors on variable references (`$tv[salon].power`) are rejected.

### Default devices & rooms

Defined in `packages/lang-core/src/prompt/defaults.ts`:
- **11 device types**: tv, light, speaker, thermostat, fan, blind, camera, vacuum, nightstand, door, switch
- **6 rooms** (French): `salon`, `chambre`, `cuisine`, `bureau`, `salle_de_bain`, `entrée`

## Project file structure

```
packages/
  devices/
    src/
      index.ts           # Re-exports everything
      types.ts           # Device, DeviceEntry, InventoryYaml types
      registry.ts        # DeviceRegistry class (fromYaml, getDevices, etc.)
      drivers/
        interface.ts     # DeviceDriver interface
        mock.ts          # MockDriver (in-memory property store)
        homeassistant.ts # HADriver (REST API via fetch)
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
        generator.ts     # generateHomeAgentPrompt()
        defaults.ts      # DEFAULT_DEVICES, DEFAULT_ROOMS
        types.ts         # PromptConfig, DeviceDefinition, etc.
    scripts/
      build-prompt.js    # Generates homeagent-prompt.md
    homeagent-prompt.md  # Generated output (260 lines)
  vm/
    src/
      index.ts           # Public API — re-exports everything below
      types.ts           # VMContext, VMResult, Session, Device, ResolutionFilter, etc.
      commands/
        types.ts         # VMCommand discriminated union (5 variants)
        dispatch.ts      # executeCommand() — single entry point dispatcher
      interactions/
        types.ts         # UserInteraction, UserResponse, InteractionHandler, PendingInteraction
        registry.ts      # Handler registry + createInteraction()/processInteractionResponse()
        device-selection.ts # DeviceSelectionHandler
        confirmation.ts  # ConfirmationHandler
        index.ts         # Re-exports + auto-registration of handlers
      middleware/
        types.ts         # Middleware, PlannedAction, PipelineOutcome, signals
        pipeline.ts       # runMiddlewarePipeline() — sequential chain evaluator
        noop.ts           # noopMiddleware
        confirmation.ts   # createConfirmationMiddleware() — pause-and-resume
      trace/
        types.ts         # ExecutionNode, ExecutionTrace, NodeKind, NodeStatus
        events.ts        # VMEvent discriminated union (10 event types)
        event-bus.ts     # VMEventBus interface + DefaultVMEventBus
        tracer.ts        # ExecutionTracer interface + DefaultExecutionTracer
        index.ts         # Re-exports everything
      interpreter.ts     # interpretProgram() — main execution loop
      executor.ts        # executeAssignment, executeIncrement, executeQuery, executePlannedAction
      resolver.ts        # resolveDevices(), resolveDeviceById(), resolveByDeviceId()
      state.ts           # createSession(), resumeAndContinue()
      collections.ts     # expandCollection(), selectFirst(), selectAll()
      validate.ts        # validateProgram() — pre-execution static validation
    __fixtures__/
      inventory.yaml     # Sample YAML inventory (7 devices)
  playground/
    src/
      index.ts           # main(): creates devices, starts REPL
      devices.ts         # createPlaygroundDevices() — 14 mock devices
      repl.ts            # startRepl() — readline-based interactive loop (handles 5 interaction types)
      format.ts          # Colored output formatting
  sdk/
    src/
      index.ts           # Re-exports (OpenNestClient + types)
      client.ts          # OpenNestClient facade (parse/execute/runDsl/resume/cancel/getSession)
      client.test.ts     # vitest tests (e2e via MockDriver)
```

## Linting & formatting

- **ESLint** — flat config at repo root `eslint.config.js`: `@eslint/js` recommended + `typescript-eslint` recommended + `eslint-config-prettier` (disables style rules that conflict with Prettier). ESLint covers correctness only; formatting is Prettier's job.
- **Prettier** — config at `.prettierrc.json`: `semi: false`, `singleQuote: true`, `arrowParens: avoid`. Write code matching this style (no semicolons, single quotes) so `format` doesn't churn.
- `lint` targets `examples/` + `packages/`; `format`/`format:check` target `(examples|packages)/**/*.+(js|ts|json|tsx)`.
- No CI and no pre-commit hooks — run `pnpm run lint` and `pnpm run format:check` manually.

## Generated files (do not edit)

- `homeagent-prompt.md` in `packages/lang-core/` — generated by `pnpm run build:prompt`.
- `dist/` in each package — generated by `pnpm run build`.
