export interface DriverRuntimeContext {
  programId: string
}

export interface DeviceDriver {
  readonly name: string
  init(
    globalConfig: Record<string, unknown>,
    deviceInitConfigs?: Record<string, Record<string, unknown>>,
  ): Promise<void>
  // Releases whatever init() acquired (websocket connections, etc.). Must be
  // idempotent — safe to call more than once or after a failed init.
  close(): Promise<void>
  // Optional readiness hook: resolves once the driver is actually ready to
  // serve requests (e.g. the HA websocket is connected and authenticated),
  // rejects on a fatal init error. Drivers with a synchronous init may omit it.
  whenReady?(): Promise<void>
  // Optional load-time check of the device config the driver will consume at
  // call time; DeviceRegistry calls it with the built driverConfig. Drivers
  // that do not implement it skip validation.
  validateDeviceConfig?(
    deviceId: string,
    deviceConfig: Record<string, unknown>,
  ): void
  getProperty(
    deviceId: string,
    property: string,
    deviceConfig: Record<string, unknown>,
    runtime?: DriverRuntimeContext,
  ): Promise<unknown>
  setProperty(
    deviceId: string,
    property: string,
    value: unknown,
    deviceConfig: Record<string, unknown>,
    runtime?: DriverRuntimeContext,
  ): Promise<void>
  executeAction(
    deviceId: string,
    action: string,
    args: Record<string, unknown>,
    deviceConfig: Record<string, unknown>,
    runtime?: DriverRuntimeContext,
  ): Promise<void>
}
