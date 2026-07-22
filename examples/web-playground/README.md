# OpenNest Web Playground

Web playground for the OpenNest VM — real-time visualization of HomeDSL execution, device interactions, policies, and VM events.

## Quick start

```bash
# From repo root
pnpm install
pnpm run build          # Build all packages (devices, lang-core, vm, web-playground)
pnpm --filter @opennest/web-playground run dev
```

Open [http://localhost:3100](http://localhost:3100).

## Architecture

```
app/
  layout.tsx            # Root layout with VMProvider
  page.tsx              # Main grid layout
  globals.css           # Tailwind v4 + dark theme

components/
  chat/                 # Chat panel: HomeDSL input + VM responses
  interactions/         # Interaction panel: device selection, confirmation
  timeline/             # Timeline: executed actions with status
  policies/             # Active policies display
  vm-events/            # Real-time VM event log
  dsl-viewer/           # Read-only DSL source viewer
  ui/                   # shadcn/ui primitives (Button, Card, Badge, etc.)
  layout/               # App header

hooks/
  use-vm.tsx            # VMContext + useVM hook (React Context + useReducer)

lib/
  vm/
    adapter.ts          # VM <-> React bridge
    devices.ts          # Playground device setup (14 mock devices)
    types.ts            # UI state types
```

## Data flow

```
User Input (HomeDSL)
    │
    ▼
VMAdapter.executeDSL()
    │
    ├── parseHomeDSL()  → AST
    ├── executeCommand() → VMResult
    │       │
    │       ├── VMEventBus → events → VMEventsPanel
    │       ├── Policies   → PolicyInfo → PoliciesPanel
    │       └── UserInteraction → InteractionPanel
    │
    ▼
useVM dispatch()  →  state update  →  all panels re-render
```

## Interaction system

When the VM pauses for human input, the `InteractionPanel` renders the appropriate UI:

| Interaction type | UI component | Response |
|---|---|---|
| `device_selection` | List of clickable device buttons | `{ type: "device_selection", deviceId }` |
| `confirmation` | Confirm / Cancel buttons | `{ type: "confirmation", confirmed }` |

To add a new interaction type:

1. Add a handler in `packages/vm/src/interactions/`
2. Create a matching UI component in `components/interactions/`
3. Add the rendering branch in `InteractionPanel`

## Adding a new policy

1. Implement `ExecutionPolicy` in `packages/vm/src/policies/`
2. Register it in `lib/vm/adapter.ts` → `createDemoPolicies()`
3. The `PoliciesPanel` auto-discovers policies via `adapter.getPolicies()`

## Adding a new panel

1. Create the component in `components/<name>/`
2. Import and place it in `app/page.tsx` grid layout
3. Access VM state via `useVM()` hook

## Demo scenario

Click **Demo** or type `light[salon].power = on`:

1. The VM resolves `light[salon]` → finds 2 lights → triggers `device_selection` interaction
2. User selects a device → VM resumes
3. ConfirmationPolicy fires → `confirmation` interaction
4. User confirms → action executes
5. All events, timeline entries, and messages update in real-time

## Stack

- Next.js 15 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Radix UI (tabs, scroll-area, separator, dialog, tooltip, slot)
- class-variance-authority + clsx + tailwind-merge (shadcn/ui utils)

## Extending

The architecture is designed for future additions without modifying existing code:

- **New panels**: add component → drop in grid
- **New interaction types**: add handler in VM → add UI branch
- **New policies**: implement interface → register in adapter
- **OpenTelemetry tracing**: subscribe to VMEventBus
- **Step-by-step execution**: wrap `executeCommand` with breakpoints
- **Execution plan visualization**: extend timeline with tree view
- **Context inspector**: add panel reading `state.session`
