# OpenNest live demo (CopilotKit + AG-UI)

A ChatGPT-style chat where you talk to an agent that drives a simulated smart
home through the OpenNest VM, and **the interface follows what the VM does,
live**:

- a slide-out **VM actions panel** shows the statements coming up, running and
  done, as they happen;
- the VM's questions (which device, confirmation, `ask()` choices, a PIN,
  missing action parameters) are answered with **buttons in the chat**, and the
  same program resumes, without going back through the language model;
- follow-up **suggestions** after a successful run are buttons under the
  agent's reply; the answer runs on the VM directly, then the agent says in a
  sentence what was done;
- a **Basic | Advanced** switch: plain sentences for an audience, or the
  runtime details (HomeDSL, resolution, middleware, verification, trace).

Each conversation gets its own simulated house. This example is private: it is
never published to npm.

## Quick start

```bash
# From the repo root
pnpm install
pnpm run build                         # builds the workspace packages
cp examples/copilotkit-demo/.env.example examples/copilotkit-demo/.env
# edit .env: OPENAI_API_KEY, or OPENAI_BASE_URL for an OpenAI-compatible server
pnpm --filter @opennest/copilotkit-demo dev
```

Open `http://localhost:3200`, or `http://<your-lan-ip>:3200` from another
device: the dev server listens on `0.0.0.0`.

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI key |
| `OPENAI_BASE_URL` | OpenAI-compatible server (a local one may need no key) |
| `OPENNEST_MODEL` | Model, default `openai/gpt-4o-mini` |
| `DEMO_DOOR_PIN` | PIN asked to unlock the entrance door, default `1234` |
| `COPILOTKIT_TELEMETRY_DISABLED` | `true` turns off CopilotKit runtime telemetry |

Without a model, the page still loads with a banner, and Advanced mode's
**HomeDSL input (no LLM)** runs programs directly.

## Demo script

| Say | What the audience sees |
|---|---|
| "Turn on the living room TV" | Two TVs match → **device buttons**; pick one, the panel goes Waiting → Done |
| "Set the living room speaker volume to 80" | `ask()` **choice**: keep 80, lower to 30, or leave it |
| "Unlock the entrance door" | `ask()` **PIN** field (`1234`); a wrong PIN blocks the unlock |
| "Turn on the bedroom light" | Done, then the **ambiance suggestion** (cinema / reading) |
| "Set the living room thermostat to 20" | **Confirmation** Yes / No |
| "Announce dinner on the living room speaker" with no message | **Action parameters** form (if the model leaves `message` out) |

Switch to **Advanced** during a run to show the HomeDSL, the resolution
(candidates, matched, excluded with the reason), middleware decisions,
`accepted · confirmed` per device and the trace tree.

Mock devices answer with 200 ms latency (`inventory.yaml`) so the panel
visibly moves.

## Architecture

```
Browser (CopilotKit v2)                   Next server (one Node process)
┌───────────────────────────┐            ┌─────────────────────────────────────┐
│ <CopilotChat>             │  AG-UI     │ /api/copilotkit  (CopilotRuntime)   │
│  useInterrupt → buttons   │◀──events───│   agent "default": OpenNestAgent    │
│  suggestion buttons       │──runs─────▶│     ├─ LLM (AI SDK, buildPrompt)    │
│ VM actions panel          │            │     ├─ HouseStore: threadId →       │
│  useAgent().state         │            │     │   { OpenNestClient, devices } │
│ Basic | Advanced switch   │            │     └─ VM events → STATE_DELTA      │
└───────────────────────────┘            └─────────────────────────────────────┘
```

- `lib/server/agent.ts`: `OpenNestAgent extends AbstractAgent`. It streams the
  model's text and `run_homedsl` tool calls, runs the program on the thread's
  house, and turns VM events into `STATE_SNAPSHOT` / `STATE_DELTA`.
- **Pauses** are standard AG-UI interrupts: `RUN_FINISHED { outcome: {
  type: 'interrupt' } }`, resumed by a run carrying `resume: [{ interruptId,
  status, payload }]`. The agent calls `OpenNestClient.resumePending()`
  directly.
- `lib/server/house.ts`: one house per thread, in memory (30 min idle TTL, at
  most 50). Restarting the server forgets them.
- `lib/server/panel-state.ts`: the panel state (`lib/shared/state.ts`) and the
  plain-English labels of Basic mode.

### Interrupt reasons and resume payloads

| VM interaction | `reason` | `resume[].payload` |
|---|---|---|
| `device_selection` | `opennest:device_selection` | `{ deviceId }` |
| `confirmation` | `confirmation` | `{ approved }` |
| `choice` | `opennest:choice` | `{ value }` |
| `text_input` | `opennest:text_input` | `{ value: string }` |
| `number_input` | `opennest:number_input` | `{ value: number }` |
| `action_parameter` | `opennest:action_parameter` | `{ values }` |

`interrupt.metadata` carries `{ interaction, error? }`; an invalid answer comes
back as the same interrupt with `error` set.

### `forwardedProps`

| Shape | Effect |
|---|---|
| `{ dsl }` | Run HomeDSL directly, no model |
| `{ answerSuggestion: { suggestionId, response } }` | Answer a follow-up suggestion: the VM runs it without the model, then one model turn (no tools) reports what was done; fixed reply without a model |
| `{ dismissSuggestion: { suggestionId } }` | Drop a suggestion |

`RUN_ERROR.code`: `interrupt_pending`, `unknown_interrupt`,
`llm_not_configured`, `llm_error`, `vm_error`.

## Scope

Local demo only: no auth, no rate limits, no persistence. Everything (houses,
paused programs, `ask()` answers) lives in the single Node process, so it
cannot run on serverless or multi-instance hosting.

## Tests

```bash
pnpm --filter @opennest/copilotkit-demo test
```

Server side only, with a scripted model: houses, panel state, interrupt
mapping, LLM port and the agent (pauses, resumes, retries, suggestions,
errors). The UI is checked by hand with the demo script above.
