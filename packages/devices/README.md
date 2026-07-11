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
| `HADriver` | REST API driver for Home Assistant. Communicates via `fetch`. |

## Exports

| Export | Kind | Description |
|---|---|---|
| `DeviceRegistry` | class | YAML → Device factory |
| `MockDriver` | class | In-memory mock driver |
| `HADriver` | class | Home Assistant REST driver |
| `DeviceDriver` | type | Driver interface |
| `Device`, `DeviceEntry`, `InventoryYaml` | types | Device and inventory types |
