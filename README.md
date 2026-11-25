# OpenNest

[![CI](https://github.com/OpenNestHQ/core/actions/workflows/ci.yml/badge.svg)](https://github.com/OpenNestHQ/core/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)

> A DSL runtime for smart environments — also known as ClawNest.

OpenNest is a language, virtual machine, and agent runtime designed to control and reason about smart environments through a structured DSL called **HomeDSL**.

```text
Natural Language → HomeAgent (LLM) → HomeDSL → VM (executeCommand) → Devices
```

---

## Packages

| Package | npm name | Role |
|---|---|---|
| [lang-core](./packages/lang-core/README.md) | `@opennest/lang-core` | Parser (HomeDSL → AST), prompt generator, AST types and builders |
| [devices](./packages/devices/README.md) | `@opennest/devices` | Device registry, `DeviceDriver` interface, mock + Home Assistant drivers |
| [vm](./packages/vm/README.md) | `@opennest/vm` | Interpreter: resolution, middleware, interactions, validation, tracing. Also ships the `@opennest/vm/effect` entry point (Effect API, cooperative stop) |
| [vm-opentelemetry](./packages/vm-opentelemetry/README.md) | `@opennest/vm-opentelemetry` | OpenTelemetry trace sink for the VM `ExecutionTrace` |
| [sdk](./packages/sdk/README.md) | `@opennest/sdk` | High-level `OpenNestClient` facade over parser + VM + devices |
| [mcp](./packages/mcp/README.md) | `@opennest/mcp` | Stdio MCP server exposing the runtime to AI agents |
| [playground](./examples/playground/README.md) | `@opennest/playground` | Interactive TUI REPL with 14 mock devices + NL→DSL agent |

A Next.js demo UI lives in [examples/web-playground](./examples/web-playground/README.md).

---

## Quick Start

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run start          # Launch the playground REPL
```

---

## HomeDSL at a Glance

The `#` lines are annotations for this page, not HomeDSL: the parser has no comment syntax.

```text
# Assignment, query, action
tv.power = on
thermostat.temperature?
vacuum.start()

# Variable, then $it (the last resolved device)
$tv = tv[living_room]
$tv.volume = 20
$it.power = off

# Batch with @all
$lights = @all(light[bedroom])
$lights.power = on

# Selectors: room, owner, tag (chainable)
light[living_room][owner:alice][tag:main].brightness = 80

# Condition
$speaker = @oneof(speaker)
@if $speaker.power? == on
    light.power = off
@endif
```

Full syntax, collection modifiers and selectors: [HomeDSL reference](./packages/lang-core/README.md#homedsl-reference).

---

## What the runtime does

- **Interactions & `ask()`** — typed, resumable user questions instead of errors: [User interactions](./packages/vm/README.md#user-interactions), [`ask()`](./packages/vm/README.md#asking-questions-with-ask).
- **Suggestions** — follow-up proposals after a run: [VM](./packages/vm/README.md#suggestions), [SDK](./packages/sdk/README.md#suggestions).
- **Middleware** — composable pipeline for blocking, confirming, expanding actions: [Middleware](./packages/vm/README.md#middleware).
- **Validation** — static pre-execution checks: [Pre-execution validation](./packages/vm/README.md#pre-execution-validation).
- **State verification** — checks that devices reach the expected state: [State verification](./packages/vm/README.md#state-verification).
- **Tracing & OpenTelemetry** — deterministic execution tree: [Execution tracing](./packages/vm/README.md#execution-tracing), exported by [vm-opentelemetry](./packages/vm-opentelemetry/README.md).
- **Effect API & stop** — `runCommand` with cooperative stop: [Effect API](./packages/vm/README.md#effect-api-opennestvmeffect).
- **SDK facade** — `OpenNestClient` for applications: [sdk](./packages/sdk/README.md#quick-start).
- **MCP server** — runtime for AI agents over stdio: [mcp](./packages/mcp/README.md).
- **Home Assistant driver** — REST + websocket bindings: [Home Assistant driver](./packages/devices/README.md#home-assistant-driver).

---

## Design Principles

1. **Separation of concerns** — LLM = compiler, VM = execution engine
2. **Deterministic execution** — same DSL + same state → same result
3. **Structured interactions** — user input is a first-class typed state, not an error
4. **Composable middleware** — pipeline for authorization, confirmation, transformation
5. **Stateful runtime** — session remembers variables, selections, history
6. **DSL as interface contract** — HomeDSL is the only interface between LLM and system

---

## Philosophy

> "The world is not controlled by prompts, but by languages."

OpenNest turns intent into execution through a structured, deterministic language layer.

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for the
development setup and guidelines, and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
for our community standards.

---

## License

This project is licensed under the ISC License — see [LICENSE](./LICENSE).
