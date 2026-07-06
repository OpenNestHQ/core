import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { InventoryYaml, Device, DeviceEntry } from "./types.js";
import type { DeviceDriver } from "./drivers/interface.js";
import { MockDriver } from "./drivers/mock.js";
import { HADriver } from "./drivers/homeassistant.js";

const driverFactories: Record<string, () => DeviceDriver> = {
  mock: () => new MockDriver(),
  homeassistant: () => new HADriver(),
};

export class DeviceRegistry {
  private devices: Device[] = [];
  private drivers = new Map<string, DeviceDriver>();

  static fromYaml(path: string): DeviceRegistry {
    const raw = readFileSync(path, "utf-8");
    const inventory = yaml.load(raw) as InventoryYaml;
    return new DeviceRegistry(inventory);
  }

  constructor(inventory: InventoryYaml) {
    this.initDrivers(inventory);
    this.initDevices(inventory);
  }

  getDevices(): Device[] {
    return this.devices;
  }

  getDevice(id: string): Device | undefined {
    return this.devices.find((d) => d.id === id);
  }

  getDriver(name: string): DeviceDriver | undefined {
    return this.drivers.get(name);
  }

  private initDrivers(inventory: InventoryYaml): void {
    for (const [name, config] of Object.entries(inventory.drivers)) {
      const factory = driverFactories[name];
      if (!factory) {
        throw new Error(`Unknown driver: "${name}". Available: ${Object.keys(driverFactories).join(", ")}`);
      }
      const driver = factory();
      driver.init(config);
      this.drivers.set(name, driver);
    }
  }

  private initDevices(inventory: InventoryYaml): void {
    for (const entry of inventory.devices) {
      const driver = this.drivers.get(entry.driver);
      if (!driver) {
        throw new Error(
          `Device "${entry.id}" references unknown driver "${entry.driver}"`,
        );
      }
      this.devices.push(this.buildDevice(entry, driver));
    }
  }

  private buildDevice(entry: DeviceEntry, driver: DeviceDriver): Device {
    return {
      id: entry.id,
      type: entry.type,
      room: entry.room,
      name: entry.name,
      driver,
      driverConfig: {
        properties: entry.properties,
        actions: entry.actions,
      },
    };
  }
}
