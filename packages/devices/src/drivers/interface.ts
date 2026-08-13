export interface DriverRuntimeContext {
  programId: string
}

export interface DeviceDriver {
  readonly name: string
  init(
    globalConfig: Record<string, unknown>,
    deviceInitConfigs?: Record<string, Record<string, unknown>>,
  ): Promise<void>
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
