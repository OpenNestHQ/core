# @opennest/playground

Interactive TUI REPL for testing HomeDSL with 14 mock devices across 3 rooms (`living_room`, `bedroom`, `entrance`), plus a natural-language mode that translates natural language into HomeDSL with an LLM.

## Quick Start

```bash
pnpm run start    # from the repo root; builds, then launches the REPL
```

If a `.env` file exists in its working directory (with `pnpm run start` that is `examples/playground/`), the playground loads it at startup. It is optional: without it the HomeDSL mode works as usual, and only [NL Mode](#nl-mode) needs configuration.

## Modes

| Mode | Command | Description |
|---|---|---|
| **HomeDSL** | *(default)* | Type HomeDSL statements directly (see the [HomeDSL reference](../../packages/lang-core/README.md#homedsl-reference)) |
| **Natural Language** | `:nl` | Type natural language, an AI translates it to HomeDSL |

## Commands

| Command | Short | Description |
|---|---|---|
| `:help` | `:h` | Show help |
| `:devices` | `:d` | List all devices |
| `:session` | `:s` | Show session state (variables, history, `$it`) |
| `:reset` | `:r` | Reset session |
| `:a <n> <answer>` | — | Answer open suggestion `n` (see [Suggestions](#suggestions)) |
| `:nl` | — | Switch to natural language mode |
| `:dsl` | — | Switch to HomeDSL mode |
| `:{` | — | Start multi-line input (executed on `:}` or a blank line) |
| `:}` | — | End multi-line input and execute it |
| `:cancel` | — | While an interaction is pending, cancel it (`:q` also cancels) |
| `:quit` | `:q` | Exit |

When a statement is ambiguous or needs approval, the REPL asks a question: type the number of the device, `y`/`n` for a confirmation, or the requested value.

### Suggestions

Some middleware can offer an optional follow-up after a program ran (for example, which ambiance to apply once lights are switched on). The REPL prints them as a numbered **Suggestions** list; answer one with `:a <n> <answer>`, where `<answer>` is a choice value or its index, a number or text depending on the question:

```text
> light[living_room].power = on
...
💡 Suggestions:
  [1] Which ambiance for these lights? (Living Room Ceiling Light, Living Room Lamp)
      [cinema] Cinema (dim, warm white)
      [reading] Reading (bright, reading mode)
  Answer with :a <n> <answer>

> :a 1 cinema
```

The statements a suggestion runs are listed under the result with a `↳ suggestion` marker, so they can be told apart from the ones you typed.

## NL Mode

The playground includes an AI agent (`:nl`) that translates natural language to HomeDSL, validates the result with the parser and retries (up to 5 attempts) on parse errors:

```text
[NL] > turn on all lights in the living room and set the tv volume to 20
  Translated to HomeDSL:
  $lights = @all(light[living_room])
  $lights.power = on
  $tv = @oneof(tv[living_room])
  $tv.volume = 20
  ✓ OK
```

**Requirements:**
- `OPENAI_API_KEY` and/or `OPENAI_BASE_URL`, at least one of them (a warning is printed when switching to `:nl` with neither):
  - `OPENAI_API_KEY` alone: OpenAI
  - `OPENAI_BASE_URL`: an OpenAI-compatible provider; the key is optional, so a local server that needs none (Ollama, LM Studio...) works with the base URL only
- Optional: `OPENNEST_MODEL` to override the default model (`openai/gpt-4o-mini`; only the part after the first `/` is sent as the model name)

```bash
# examples/playground/.env — OpenAI
OPENAI_API_KEY=sk-...
# OPENNEST_MODEL=openai/gpt-4o

# or a keyless OpenAI-compatible server
# OPENAI_BASE_URL=http://localhost:11434/v1
# OPENNEST_MODEL=ollama/llama3.1
```

`pnpm --filter @opennest/playground run print:prompt` prints the system prompt sent to the model.

## Devices

14 mock devices across 3 rooms, defined in [`inventory.yaml`](./inventory.yaml):

| Room | Devices |
|---|---|
| `living_room` | 2 TVs, 2 lights, thermostat, speaker, vacuum |
| `bedroom` | TV, light, speaker, fan |
| `entrance` | camera, door, switch |

Owners (`Alice`, `Bob`, `kids`, `everybody`) and tags are set on some devices, so selectors such as `light[owner:Alice]` work.

## Demo middleware

The playground wires four middleware (`src/middleware.ts`, `src/index.ts`) to showcase the [VM middleware and interactions](../../packages/vm/README.md#middleware):

| Middleware | Behavior |
|---|---|
| `doorPin` | Unlocking a door asks for a PIN (`PLAYGROUND_DOOR_PIN`, default `1234`); a wrong PIN blocks the action |
| `quietVolume` | A TV or speaker volume above 60 asks whether to keep it, lower it to 30, or skip that device |
| `createConfirmationMiddleware` | Setting a thermostat temperature asks for confirmation |
| `suggestAmbiance` | Switching a light on offers a `cinema` / `reading` ambiance as a suggestion |

## OpenTelemetry (optional)

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (an OTLP/HTTP traces URL such as `http://localhost:4318/v1/traces`) to export every run as spans through [`@opennest/vm-opentelemetry`](../../packages/vm-opentelemetry/README.md). `OTEL_SERVICE_NAME` overrides the service name (default `opennest-playground`). Without the endpoint, tracing is off.

## Tab Completion

The REPL supports tab completion for device types, room names, variables, and commands.
