import type { DeviceDriver, DriverRuntimeContext } from './interface.js'

export class MockDriver implements DeviceDriver {
  readonly name = 'mock'
  private store = new Map<string, Map<string, unknown>>()
  private latency: number = 0

  async init(globalConfig: Record<string, unknown>): Promise<void> {
    if (typeof globalConfig['latency'] === 'number') {
      this.latency = globalConfig['latency']
    }
  }

  getProperty(
    deviceId: string,
    property: string,
    // to match implemntation of DeviceDriver interface
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _deviceConfig?: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _runtime?: DriverRuntimeContext,
  ): Promise<unknown> {
    return this._getProperty(deviceId, property)
  }

  async _getProperty(deviceId: string, property: string): Promise<unknown> {
    await this.delay()
    const deviceStore = this.store.get(deviceId)
    if (!deviceStore) return null
    return deviceStore.get(property) ?? null
  }

  setProperty(
    deviceId: string,
    property: string,
    value: unknown,
    // to match implemntation of DeviceDriver interface
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _deviceConfig?: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _runtime?: DriverRuntimeContext,
  ): Promise<void> {
    return this._setProperty(deviceId, property, value)
  }

  async _setProperty(
    deviceId: string,
    property: string,
    value: unknown,
  ): Promise<void> {
    await this.delay()
    let deviceStore = this.store.get(deviceId)
    if (!deviceStore) {
      deviceStore = new Map()
      this.store.set(deviceId, deviceStore)
    }
    deviceStore.set(property, value)
  }

  // to match implemntation of DeviceDriver interface
  executeAction(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _deviceId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _action: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _args: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _deviceConfig: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _runtime?: DriverRuntimeContext,
  ): Promise<void> {
    return this._executeAction()
  }
  async _executeAction(): Promise<void> {
    await this.delay()
  }

  seed(deviceId: string, properties: Record<string, unknown>): void {
    let deviceStore = this.store.get(deviceId)
    if (!deviceStore) {
      deviceStore = new Map()
      this.store.set(deviceId, deviceStore)
    }
    for (const [key, value] of Object.entries(properties)) {
      deviceStore.set(key, value)
    }
  }

  getStore(): ReadonlyMap<string, Map<string, unknown>> {
    return this.store
  }

  private delay(): Promise<void> {
    if (this.latency <= 0) return Promise.resolve()
    return new Promise(resolve => setTimeout(resolve, this.latency))
  }
}
