# @opennest/devices

Device registry, driver interface, and driver implementations.

## Install

```bash
pnpm add @opennest/devices
```

## API

### `DeviceRegistry`

Loads device inventories from YAML and instantiates drivers.

```ts
import { DeviceRegistry } from "@opennest/devices";

const registry = DeviceRegistry.fromYaml(yamlString);
const devices = registry.getDevices();
```

### `DeviceDriver` interface

```ts
interface DeviceDriver {
  readonly name: string;
  init(config: Record<string, unknown>): Promise<void>;
  getProperty(deviceId: string, property: string): Promise<unknown>;
  setProperty(deviceId: string, property: string, value: unknown): Promise<void>;
  executeAction(deviceId: string, action: string, params?: Record<string, unknown>): Promise<unknown>;
}
```

### Drivers

| Driver | Description |
|---|---|
| `MockDriver` | In-memory driver for testing. Properties stored in a `Map`. Supports `seed(id, props)`. |
| `HADriver` | Home Assistant driver. Declarative binding strategies executed over the HA REST API and websocket — see [Home Assistant driver](#home-assistant-driver). |

## Home Assistant driver

The HA driver turns each OpenNest property and action into declarative
**binding strategies** (`get` / `set` on properties, a `kind` on actions),
executed against the Home Assistant REST API and websocket. The inventory
declares *what* to call; the driver handles transport, realtime state,
caching and value translation.

An inventory can be written in two formats:

- **Strategy format** (recommended): properties declare `get`/`set` strategy
  objects, actions declare a `kind`. Bindings are validated when the
  inventory loads — a broken binding fails the load, not the first call.
- **Flat format** (legacy, still fully supported): `entity`/`attribute`/
  `set_service`/`set_value_key` on properties, `service`/`target`/`data` on
  actions. Flat bindings are not validated at load (retrocompatibility) —
  see [Migrating from the flat format](#migrating-from-the-flat-format).

A complete, commented inventory is available at
[`examples/inventory.ha.yaml`](examples/inventory.ha.yaml), and every `yaml`
snippet of this document is pinned to the load-time validation by a test
(`src/drivers/ha/examples.test.ts`).

### Driver config

```yaml
drivers:
  homeassistant:
    url: http://homeassistant.local:8123
    token: <long-lived access token>
```

- `url` — base URL of the HA instance: REST calls, template renders and
  fallback reads. The websocket URL is derived from it (`http` → `ws`).
- `token` — long-lived access token, used for REST auth and websocket auth.
  The socket re-authenticates on every (re)connection; an `auth_invalid`
  rejection is fatal and fails with an explicit error instead of retrying.

### Property bindings

A property declares a `get` strategy, a `set` strategy and an optional value
contract:

```yaml
properties:
  power:
    type: boolean
    entity: light.salon
    get: { kind: state }
    set: { kind: inferred }
```

- `entity` — the HA entity the property reads from and/or writes to.
  Required by `state`/`attribute` gets and `inferred`/`service` sets;
  `template`, `script` and `service_response` strategies need none.
- Omit `get` to read the entity state by default; omit `set` for a
  read-only property (the default `inferred` set is then simply never
  called). A write-only property declares `set` only.

#### get strategies

| kind | reads | transport |
|---|---|---|
| `state` | the entity state string | store → REST |
| `attribute` | one attribute of the entity | store → REST |
| `template` | a rendered Jinja2 template | REST (`POST /api/template`) |
| `script` | a script's response variable | websocket (`return_response`) |
| `service_response` | a service call's response | websocket (`return_response`) |

```yaml
properties:
  volume:
    type: number
    entity: media_player.salon
    get:
      kind: attribute
      attribute: volume_level
```

```yaml
properties:
  outdoor_temperature:
    type: number
    get:
      kind: template
      template: '{{ states("sensor.outdoor") | float }}'
```

```yaml
properties:
  summary:
    get:
      kind: script
      script: script.daily_summary
```

```yaml
properties:
  forecast:
    get:
      kind: service_response
      service: weather.get_forecasts
      fields:
        entity_id: weather.home
```

Notes:

- `state`/`attribute` reads resolve the entity state through the fallback
  chain described in [Realtime state & fallback chain](#realtime-state--fallback-chain).
- `template` renders go over REST and are cached per program with the same
  TTL as entity states (5 s), keyed by the template hash; concurrent renders
  of the same template share a single request. Template reads are **not**
  invalidated by writes — a template targets no entity, so only the TTL
  bounds their staleness.
- `script` runs the script over the websocket with `return_response` and
  returns its single response variable (a multi-key response is returned
  as-is). `service_response` calls the declared service the same way, with
  `fields` merged into the call payload.
- Both websocket get strategies require a connected socket and have **no
  REST fallback**: when the socket is down they fail immediately with an
  explicit error.

#### Realtime state & fallback chain

`state`/`attribute` reads resolve the entity state through, in order:

1. the **live store** fed by `subscribe_entities` push events — read only
   while the websocket is ready; `unavailable`/`unknown` states are stored
   as-is,
2. a **REST** `GET /api/states/<entity>` fallback — socket down, or entity
   missing from the store,
3. the **per-program TTL cache** (5 s) in front of that REST call — within a
   program run, the same entity is fetched at most once per TTL window
   (reads outside a program run bypass the cache).

After any write (set or action) the entities the call may have touched are
dropped from the store and the REST cache is cleared, so the next read is
never stale. When the write scope cannot be determined (script writes,
service calls without an `entity_id` target) the whole store is dropped.

The websocket client heartbeats (`ping` every 30 s, commands time out after
10 s) and reconnects with an exponential backoff (1 s doubling up to 30 s).
On reconnection the store is cleared and re-subscribed, rebuilding from the
fresh initial dump; commands issued during a disconnection are queued and
flushed once the socket is ready again.

#### set strategies

| kind | calls | value |
|---|---|---|
| `inferred` | `<entity domain>.turn_on` / `turn_off` (`lock`: `lock.lock` / `lock.unlock`) | booleans only |
| `service` | the declared service (REST) | written under `key`, after value mapping |
| `script` | `script.turn_on` (REST) with `fields` | the `$value` placeholder is replaced by the mapped value |

```yaml
properties:
  power:
    type: boolean
    entity: light.salon
    set: { kind: inferred }
```

`inferred` resolves the service from the entity domain and cannot write
non-boolean values: declaring it on a property with a non-boolean contract
is rejected at load (see [Load-time validation](#load-time-validation)), and
writing one through an undeclared set resolves the invalid
`<domain>.unknown` service and fails.

```yaml
properties:
  volume:
    type: number
    entity: media_player.salon
    set:
      kind: service
      service: media_player.volume_set
      key: volume_level
```

`target` is merged into the service payload; the value is mapped through the
value contract before being written under `key`.

```yaml
properties:
  away:
    set:
      kind: script
      script: script.set_away
      fields:
        mode: $value
```

Script sets (like script actions) always go over REST — `script.turn_on`
with the declared `fields`. Only the `$value` placeholder is available when
setting; any other placeholder is rejected at load. The value is mapped
through the value contract only when a `$value` placeholder actually carries
it. Every write is followed by the invalidation described above, so the push
store and the REST cache never serve a stale value after a write.

#### Value contracts (`type`, `values`, `map`, `map_set`)

Declared on the property, shared by both formats:

| key | direction | role |
|---|---|---|
| `type` | — | OpenNest-facing coercion: `boolean`, `number` or `string` |
| `values` | — | allowed OpenNest values (string contract — cannot combine with a non-string `type`) |
| `map` | HA → OpenNest | translate raw HA values on get |
| `map_set` | OpenNest → HA | explicit set-side translation |

Get pipeline: `map` lookup → coercion to `type` → `values` membership. The
membership check applies when a `map` or a `type` is declared, the coercion
when a `type` is declared; an untyped, unmapped `state` get keeps the legacy
on/off/number parsing of the flat driver.

```yaml
properties:
  hvac_mode:
    type: string
    values: [auto, heat, cool, off]
    entity: climate.salon
    get:
      kind: attribute
      attribute: hvac_mode
    map:
      heat_cool: auto
      auto: auto
      heat: heat
      cool: cool
      off: off
    map_set:
      auto: heat_cool
      heat: heat
      cool: cool
      off: off
    set:
      kind: service
      service: climate.set_hvac_mode
      key: hvac_mode
```

- **Absent data is not a contract violation**: a missing attribute or a null
  value passes through as `null`, untouched. A value that is *present but
  out of contract* — including HA `unavailable`/`unknown` states — fails the
  get with a clear error. With a bare `map` (no `type`, no `values`), values
  that miss the map pass through unchanged.
- **Set side**: the declared `values` are checked first, then an explicit
  `map_set` applies strictly (a value outside it is an error), otherwise the
  inverse of `map` applies when exactly one HA key produces the value — an
  ambiguous inverse is an error asking for an explicit `map_set`, and a
  value matching no `map` key is written raw. Only strategies that actually
  write the value (`service` with a `key`, `script` with `$value`) map and
  check it; `inferred` booleans never do.

Coercion example — HA sensors often report booleans as `1`/`0`:

```yaml
properties:
  power:
    type: boolean
    entity: switch.plug
    map:
      '1': true
      '0': false
    set: { kind: inferred }
```

#### Action bindings

```yaml
actions:
  play:
    kind: service
    service: media_player.media_play
    target:
      entity_id: media_player.salon
  mute:
    kind: service
    service: media_player.volume_mute
    target:
      entity_id: media_player.salon
    data:
      is_volume_muted: true
```

`kind: service` calls the service over REST, merging `target`, then `data`,
then the call arguments into the payload (later keys win).

```yaml
actions:
  boost:
    kind: script
    script: script.boost
    fields:
      minutes: $minutes
    parameters:
      - name: minutes
        type: number
        required: true
        range: [1, 60]
```

`kind: script` runs the script over REST (`script.turn_on`) with the
declared `fields`, interpolating `$name` placeholders from the call
arguments; a placeholder whose argument is missing is omitted, keeping
optional arguments optional.

The optional `parameters` contract is enforced at call time, before any HA
call: required presence, `type` (`string`/`number`/`power`/`enum`), allowed
`values` and numeric `range`. It applies to both formats, and placeholders
are cross-checked against it at load: a `$name` placeholder without a
matching declared parameter is an orphan and fails the load.

#### Load-time validation

Strategy-format entries are validated when the inventory loads; flat-format
entries are left untouched (retrocompatibility). Failures cite the device
and the property or action:

```text
Invalid HA binding for device "lamp_salon", property "power": unknown get kind "levitate" (expected: state, attribute, template, script, service_response)
```

Checked among others: unknown strategy kinds, service id format
(`domain.service`) and script id format (`script.<name>`), orphan
placeholders, `inferred` sets on non-boolean contracts, declared `values`
with a non-string `type`, value-contract coherence (`map` targets coercible
to the declared `type` and inside the declared `values`, `map_set` keys
inside `values`), set-direction bijectivity (a non-bijective `map` without
an explicit `map_set` is rejected when the set strategy writes the value),
and the flat/strategy mix described in the migration section below.

### Migrating from the flat format

The flat format keeps working; migrate incrementally with these
equivalences:

| Flat | Strategy format |
|---|---|
| `attribute: x` | `get: { kind: attribute, attribute: x }` |
| (nothing declared) | `get: { kind: state }` (default) |
| `set_service: s` + `set_value_key: k` | `set: { kind: service, service: s, key: k }` |
| `set_service: s` (alone) | `set: { kind: inferred }` |
| action `service` / `target` / `data` | `kind: service` with the same `target` / `data` |

Two legacy behaviors are intentionally not reproduced:

- **`set_service` with a `{value}` template** (e.g. `lock.{value}`) — the
  flat config normalizes to `inferred`, which resolves the services from the
  **entity** domain, while the template resolved them from its own domain.
  The boolean behavior is preserved only when the two domains agree and the
  word matches (`lock.{value}` on a `lock.*` entity); otherwise — e.g. a
  `cover.{value}` template, which wrote `cover.on` — declare an explicit
  `kind: service` set strategy.
- **`set_service` called as-is for non-boolean values** without
  `set_value_key` — declare an explicit `service` or `script` set strategy
  instead; the non-boolean value would otherwise resolve the invalid
  `<domain>.unknown` service.

The flat `attribute` field remains valid on strategy-format properties (it
feeds the get side when `get` is omitted), and mixing flat set fields with
the strategy format is rejected: a property carrying `get`/`set` must not
also carry `set_service`/`set_value_key`, since the flat set fields would be
silently ignored. That mix fails the load with the device and property
cited, in line with the rest of the load-time validation — the
retrocompatibility contract covers the pure flat format, never the hybrid.

The value contract (`type` / `values` / `map` / `map_set`) is shared by both
formats at runtime; it is only load-validated on strategy-format properties,
so flat configs with an unknown `type` keep the legacy on/off/number
heuristic.
