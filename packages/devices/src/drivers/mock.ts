import type { DeviceDriver } from "./interface.js";

export class MockDriver implements DeviceDriver {
  readonly name = "mock";
  private store = new Map<string, Map<string, unknown>>();
  private latency: number = 0;

  async init(globalConfig: Record<string, unknown>): Promise<void> {
    if (typeof globalConfig["latency"] === "number") {
      this.latency = globalConfig["latency"];
    }
  }

  async getProperty(
    deviceId: string,
    property: string,
    _deviceConfig: Record<string, unknown>,
  ): Promise<unknown> {
    await this.delay();
    const deviceStore = this.store.get(deviceId);
    if (!deviceStore) return null;
    return deviceStore.get(property) ?? null;
  }

  async setProperty(
    deviceId: string,
    property: string,
    value: unknown,
    _deviceConfig: Record<string, unknown>,
  ): Promise<void> {
    await this.delay();
    let deviceStore = this.store.get(deviceId);
    if (!deviceStore) {
      deviceStore = new Map();
      this.store.set(deviceId, deviceStore);
    }
    deviceStore.set(property, value);
  }

  async executeAction(
    _deviceId: string,
    _action: string,
    _deviceConfig: Record<string, unknown>,
  ): Promise<void> {
    await this.delay();
  }

  seed(deviceId: string, properties: Record<string, unknown>): void {
    let deviceStore = this.store.get(deviceId);
    if (!deviceStore) {
      deviceStore = new Map();
      this.store.set(deviceId, deviceStore);
    }
    for (const [key, value] of Object.entries(properties)) {
      deviceStore.set(key, value);
    }
  }

  getStore(): ReadonlyMap<string, Map<string, unknown>> {
    return this.store;
  }

  private delay(): Promise<void> {
    if (this.latency <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.latency));
  }
}
