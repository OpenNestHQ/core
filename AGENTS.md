# AGENTS.md

## Project

OpenNest (also called ClawNest) — a DSL runtime for smart environments: HomeDSL → parser → VM interpreter.

The pipeline: **Natural Language → HomeAgent (LLM) → HomeDSL → VM (`interpret_home_dsl`) → Devices.**

No root `src/` — all code lives in `packages/`. No root `package.json` — packages are independent, linked via `file:` dependencies.

## Package map

| Package | npm name | Role | Depends on |
|---|---|---|---|
| `packages/lang-core` | `@opennest/lang-core` | Parser (HomeDSL → AST), prompt generator, AST types | *none* |
| `packages/devices` | `@opennest/devices` | Device registry, `DeviceDriver` interface, mock + HA drivers | *none* (only `js-yaml`) |
| `packages/vm` | `@opennest/vm` | Interpreter: `interpret_home_dsl()`, resolver, state, ambiguity | `lang-core`, `devices` |
| `packages/playground` | `@opennest/playground` | Interactive TUI/REPL demo with 14 mock devices | `lang-core`, `devices`, `vm` |

Cross-package deps use `"file:../<pkg>"` in package.json, not workspaces.

## Commands

No root-level tooling. Run everything per-package with `cd`:

```bash
# Build (in order — vm needs both deps built first, playground needs all three)
cd packages/devices && npm run build
cd packages/lang-core && npm run build
cd packages/vm && npm run build
cd packages/playground && npm run build

# Test (all packages except playground)
cd packages/devices && npm run test
cd packages/lang-core && npm run test
cd packages/vm && npm run test

# Generate HomeAgent prompt markdown (requires lang-core already built)
cd packages/lang-core && npm run build:prompt

# Run playground REPL
cd packages/playground && npm start
```

**Do NOT use `-w` flag** — there is no root `package.json` with workspaces configured.

## Build order

1. `devices` and `lang-core` — no cross-package deps, build independently (parallel-safe).
2. `vm` — depends on both `devices` + `lang-core` (both must be built first).
3. `playground` — depends on `devices` + `lang-core` + `vm` (all three must be built first).
4. `lang-core`'s `build:prompt` requires `dist/` to exist, so `build` must run first.

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
- Run all tests: `npm run test` (from the package directory).
- Run a single file: `npx vitest run path/to/file.test.ts` (from the package directory).
- **playground has no tests.**
- `vm` tests create devices inline with `MockDriver` + `seed()`. No external fixture files are required at runtime. An `__fixtures__/inventory.yaml` exists for reference (7 sample devices).
- `devices` tests use temporary YAML files in `/tmp/` for registry tests. `homeassistant.test.ts` uses `vi.stubGlobal("fetch", ...)` to mock HTTP calls.

## Architecture notes

### Entry points

- **VM**: `interpret_home_dsl(program: Program, context: VMContext) → Promise<VMResult>` in `packages/vm/src/index.ts`. Delegates to `interpretProgram()` in `interpreter.ts`.
- **Parser**: `parseHomeDSL(source: string) → ParseResult` in `packages/lang-core/src/parser/parser.ts`.
- **Prompt**: `generateHomeAgentPrompt(config?: PromptConfig) → string` in `packages/lang-core/src/prompt/generator.ts`.
- **Registry**: `DeviceRegistry.fromYaml(yaml: string)` in `packages/devices/src/registry.ts`.

### VM context types

- `VMContext = { devices: Device[], session?: Session }`. Devices embed a `DeviceDriver` instance, not a driver name.
- `Device` = `{ id, type, room, name, driver: DeviceDriver, driverConfig }`.
- `DeviceDriver` (in `packages/devices/src/drivers/interface.ts`) exposes: `name`, `init()`, `getProperty()`, `setProperty()`, `executeAction()`.
- `Session` carries: `variables`, `it`, `history`, `cursor`, `resolvedIds`, `variableModifiers`.

### VMResult

```typescript
{ status: "success" | "waiting" | "error",
  session: Session,
  executed: ExecutedStatement[],
  awaiting: AmbiguityInfo | null,
  errors: VMError[] }
```

### Ambiguity handling

Ambiguity is a first-class concern. When device resolution produces multiple matches, the VM returns `status: "waiting"` with an `AmbiguityInfo` tree — not an error.

The caller uses `applyResolution(session, deviceType, deviceId)` to pick a device, then re-calls `interpret_home_dsl` with the updated session.

### Intent filtering (auto-disambiguation)

When a statement targets a property or action, the resolver filters out devices that don't support it (based on `driverConfig`). This can auto-disambiguate without user input. Filter feedback is included in `ExecutedStatement.filter` as `ResolutionFilter`:
```typescript
{ candidates: number, matched: number, excluded: ExcludedDevice[] }
```
Excluded devices report `reason: "property_not_supported" | "action_not_supported"`.

### Collections & wildcards

- `@all(type[room])` — expands to all matches, bypasses ambiguity, executes in batch.
- `@first(type[room])` — selects the first match.
- `[*]` wildcard room selector — matches devices in all rooms, bypasses ambiguity.
- Variables remember their modifier: `lights = @all(light[salon])` binds with `@all` semantics.

### `it` context

The last successfully resolved device is stored in `session.it`. It persists across VM calls within the same session.

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
      index.ts           # interpret_home_dsl() + re-exports
      types.ts           # VMContext, VMResult, Session, Device, etc.
      interpreter.ts     # interpretProgram() — main execution loop
      executor.ts        # executeAssignment, executeIncrement, executeQuery, executeAction
      resolver.ts        # resolveDevices(), resolveDeviceById()
      state.ts           # createSession(), applyResolution()
      collections.ts     # expandCollection(), selectFirst(), selectAll()
      ambiguity.ts       # buildAmbiguityInfo(), buildAmbiguityTree()
    __fixtures__/
      inventory.yaml     # Sample YAML inventory (7 devices)
  playground/
    src/
      index.ts           # main(): creates devices, starts REPL
      devices.ts         # createPlaygroundDevices() — 14 mock devices
      repl.ts            # startRepl() — readline-based interactive loop
      format.ts          # Colored output formatting
```

## No CI / no lint

This repo has no CI workflows (`.github/` absent), no ESLint, and no Prettier config. There are no pre-commit hooks. Formatting and lint errors must be caught manually.

## Generated files (do not edit)

- `homeagent-prompt.md` in `packages/lang-core/` — generated by `npm run build:prompt`.
- `dist/` in each package — generated by `npm run build`.
