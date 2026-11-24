# @opennest/mcp

A stdio [MCP](https://modelcontextprotocol.io) server that exposes the OpenNest HomeDSL runtime to AI agents. The agent writes HomeDSL, the server parses, validates and executes it against your device inventory, and reports a structured result.

## Installation

> **Not yet published.** Publishing to a package registry is out of scope for now, so `npx @opennest/mcp` does not work until the package is released. Until then, build it from this monorepo (see [Development](#development)) and run `node packages/mcp/dist/cli.js`.

Once published, run it with:

```bash
npx @opennest/mcp
```

Requires Node.js >= 24.

### Client configuration

Typical MCP client entry:

```json
{
  "mcpServers": {
    "opennest": {
      "command": "npx",
      "args": ["@opennest/mcp"],
      "env": { "OPENNEST_YAML": "/absolute/path/to/opennest.yaml" }
    }
  }
}
```

### Environment variables

| Variable                      | Default         | Description                                                                                    |
| ----------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `OPENNEST_YAML`               | `opennest.yaml` | Path to the device inventory (relative to the working directory).                              |
| `OPENNEST_MAX_FAILED_RESUMES` | `2`             | Invalid `respond` answers tolerated before the pending interaction is cancelled. Integer >= 1. |

The inventory is loaded once at startup. If it is missing, unreadable or invalid, the server prints a message to stderr and exits with code 1 without serving. stdout is reserved for the MCP protocol; all diagnostics go to stderr.

## Tools

| Tool          | Input                               | Description                                                                                                     |
| ------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `run_dsl`     | `{ dsl: string, dryRun?: boolean }` | Parse, validate and execute a HomeDSL program. With `dryRun: true` the program is only checked, never executed. |
| `respond`     | `{ response: { type, ... } }`       | Answer the pending user interaction. The `type` must match the interaction; no id is needed.                    |
| `cancel`      | `{}`                                | Cancel the pending program and reset the session. Safe to call when nothing is pending.                         |
| `get_session` | `{}`                                | Read-only summary of the session: variables, `$it`, recent history, pending interaction.                        |

`respond.response` is one of:

```ts
| { type: 'device_selection'; deviceId: string }
| { type: 'confirmation'; confirmed: boolean }
| { type: 'text_input'; text: string }
| { type: 'number_input'; value: number }
| { type: 'choice'; value: string }
| { type: 'action_parameter'; values: Record<string, string> }
```

### Resources

| URI                        | MIME type          | Content                                                                                                                                      |
| -------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `opennest://dsl-reference` | `text/markdown`    | The HomeDSL reference for this inventory.                                                                                                    |
| `opennest://devices`       | `application/json` | Snapshot of the inventory: `id`, `type`, `room`, `name`, and when available `owners`, `tags` and `capabilities` (`{ properties, actions }`). |

## Results

Every tool returns a `ToolResult` envelope, both as JSON text content and as `structuredContent`.

```ts
type ToolResult =
  | {
      status: 'completed'
      result?: RunResultSummary
      session?: SessionSummary
      deviceFailures?: { deviceId: string; message: string }[]
    }
  | { status: 'waiting_for_user'; interaction: InteractionPrompt }
  | {
      status: 'blocked'
      error: {
        code: 'interaction_pending' | 'no_pending_interaction'
        message: string
        interactionType?: string
      }
    }
  | {
      status: 'failed'
      error: { code: string; message: string; hint?: string }
    }
```

- `completed` — the program ran (or `dryRun` checked it). After a run, `result` holds `{ status, executed, errors }`, where `executed` lists only the statements of this program. A successful `dryRun` returns a bare `{ status: 'completed' }` with no `result`. `get_session` returns `session` instead.
- `deviceFailures` — present on `completed` only when a device driver rejected a command (action or property write). The program itself ran, so the status stays `completed`: **report `deviceFailures` to the user**. `execution_failed` covers VM/runtime errors.
- `waiting_for_user` — execution is suspended until the user answers `interaction`.
- `blocked` — the call is not allowed in the current state (see error codes).
- `failed` — the call failed; `error.code` is one of the codes below.

### InteractionPrompt

Interaction ids are never exposed: `respond` targets the single pending interaction automatically. `choices[].id` values are device or option ids and are what you send back: as `deviceId` for `device_selection`, as `value` for `choice`.

```ts
type InteractionPrompt =
  | {
      type: 'device_selection'
      prompt: string
      choices: { id: string; label: string }[]
    }
  | { type: 'confirmation'; prompt: string }
  | { type: 'text_input'; prompt: string; placeholder?: string }
  | {
      type: 'number_input'
      prompt: string
      min?: number
      max?: number
      step?: number
    }
  | { type: 'choice'; prompt: string; choices: { id: string; label: string }[] }
  | {
      type: 'action_parameter'
      prompt: string
      missing: {
        name: string
        type: 'string' | 'number' | 'power' | 'enum'
        values?: string[]
      }[]
    }
```

### Error codes

| Code                           | Status    | Meaning                                                                                                   |
| ------------------------------ | --------- | --------------------------------------------------------------------------------------------------------- |
| `parse_error`                  | `failed`  | The HomeDSL program has a syntax error.                                                                   |
| `validation_error`             | `failed`  | The program parsed but failed static validation (unknown device, unsupported property, ...).              |
| `execution_failed`             | `failed`  | The program was valid but the VM/runtime reported errors (device driver failures are `deviceFailures`).   |
| `interaction_pending`          | `blocked` | `run_dsl` was called while an interaction is pending. `respond` or `cancel` first.                        |
| `no_pending_interaction`       | `blocked` | `respond` was called with nothing pending. (Also a retryable `failed` code, see below.)                   |
| `interaction_id_mismatch`      | `failed`  | The answer targeted a stale interaction. Retryable.                                                       |
| `interaction_type_mismatch`    | `failed`  | The answer `type` does not match the pending interaction. Retryable.                                      |
| `unknown_device_id`            | `failed`  | A `device_selection` answer named a device that is not among the choices. Retryable.                      |
| `no_pending_program`           | `failed`  | The session lost its suspended program. Retryable.                                                        |
| `no_session`                   | `failed`  | The core could not resume because there is no active session.                                             |
| `invalid_response`             | `failed`  | An answer to a text/number/choice question was rejected (empty, out of range, unknown option). Retryable. |
| `interaction_aborted`          | `failed`  | Too many invalid answers (`OPENNEST_MAX_FAILED_RESUMES`); the interaction was cancelled. Start over.      |
| `unsupported_interaction_type` | `failed`  | The runtime suspended on an interaction type this server cannot present.                                  |
| `core_error`                   | `failed`  | Unexpected error from the OpenNest core.                                                                  |

Malformed tool input (schema violations, e.g. `respond` without `deviceId`) is rejected by the MCP layer as an `isError` transport error with plain text; it is not a `ToolResult` and does not consume the retry budget.

Retryable state errors can be repeated up to `OPENNEST_MAX_FAILED_RESUMES` times; beyond that the server cancels the interaction and returns `interaction_aborted`.

## Interaction protocol

1. Call `run_dsl` with a HomeDSL program.
2. If the result is `completed`, you are done. If it is `failed`, fix the program using `error.message` and call `run_dsl` again.
3. If the result is `waiting_for_user` (for example an ambiguous device, a confirmation or a missing parameter), **relay `interaction.prompt` to the user** and wait for their answer. Do not guess it.
4. Call `respond` with the answer whose `type` matches `interaction.type` (e.g. `{ "response": { "type": "device_selection", "deviceId": "light_salon_2" } }`).
5. The result of `respond` may be `completed`, `failed`, or another `waiting_for_user` — repeat from step 3.
6. While an interaction is pending, `run_dsl` returns `blocked` / `interaction_pending`. Answer with `respond`, or call `cancel` to abandon the program.
7. `get_session` shows the current state at any time without side effects.

## Sessions are ephemeral

The session (variables, `$it`, history, pending interaction) lives in memory in the server process. It is not persisted: restarting the server, or your client restarting it, starts a fresh session. A single session is shared by all calls on the connection, and calls are executed one at a time.

## Development

From the monorepo root:

```bash
pnpm install
pnpm --filter @opennest/mcp run build   # compile to dist/
pnpm --filter @opennest/mcp run test    # vitest

OPENNEST_YAML=packages/vm/__fixtures__/inventory.yaml node packages/mcp/dist/cli.js
```
