export interface DeviceDriver {
  readonly name: string
  init(globalConfig: Record<string, unknown>): Promise<void>
  getProperty(
    deviceId: string,
    property: string,
    deviceConfig: Record<string, unknown>,
  ): Promise<unknown>
  setProperty(
    deviceId: string,
    property: string,
    value: unknown,
    deviceConfig: Record<string, unknown>,
  ): Promise<void>
  executeAction(
    deviceId: string,
    action: string,
    deviceConfig: Record<string, unknown>,
  ): Promise<void>
}
