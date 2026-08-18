# @opennest/playground

Interactive TUI REPL for testing HomeDSL with 14 mock devices across 4 rooms.

## Quick Start

```bash
pnpm run start
```

## Modes

| Mode | Command | Description |
|---|---|---|
| **HomeDSL** | *(default)* | Type HomeDSL statements directly |
| **Natural Language** | `:nl` | Type natural language, AI translates to HomeDSL |

## Commands

| Command | Short | Description |
|---|---|---|
| `:help` | `:h` | Show help |
| `:devices` | `:d` | List all devices |
| `:session` | `:s` | Show session state (variables, history, `$it`) |
| `:reset` | `:r` | Reset session |
| `:nl` | — | Switch to natural language mode |
| `:dsl` | — | Switch to HomeDSL mode |
| `:{` | — | Start multi-line input |
| `:}` | — | End multi-line input |
| `:quit` | `:q` | Exit |

## NL Mode

Translates natural language to HomeDSL using OpenAI (or compatible API).

**Requirements:**
- `OPENAI_API_KEY` environment variable
- Optional: `OPENAI_BASE_URL` for alternative providers
- Optional: `OPENNEST_MODEL` to override default model (`openai/gpt-4o-mini`)

```bash
# .env file
OPENAI_API_KEY=sk-...
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENNEST_MODEL=openai/gpt-4o
```

## Devices

14 mock devices across 4 rooms:

| Room | Devices |
|---|---|
| salon | 2 TVs, 2 lights, thermostat, speaker, vacuum |
| chambre | TV, light, speaker, fan |
| entrée | camera, door, switch |

## Tab Completion

The REPL supports tab completion for device types, room names, variables, and commands.
