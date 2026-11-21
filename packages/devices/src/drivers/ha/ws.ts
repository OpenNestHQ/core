import { makeHAWsCore, runPromise } from './ws-core.js'
import type { HAIncomingMessage, HAWsCore } from './ws-core.js'

export { HAWsAuthError } from './ws-errors.js'
export type { HAIncomingMessage } from './ws-core.js'

export interface HAWebSocketClientOptions {
  url: string
  token: string
  commandTimeoutMs?: number
  heartbeatIntervalMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
}

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_RECONNECT_BASE_MS = 1000
const DEFAULT_RECONNECT_MAX_MS = 30_000

export function toHaWsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/api/websocket`
}

/**
 * Promise façade over the Effect client in `ws-core.ts`. Commands issued
 * while disconnected are queued and sent on the next successful auth;
 * `isReady()` is synchronous and `callService` sends (or enqueues) before
 * returning, so no await may separate the two.
 */
export class HAWebSocketClient {
  private readonly core: HAWsCore

  constructor(options: HAWebSocketClientOptions) {
    this.core = makeHAWsCore({
      url: options.url,
      token: options.token,
      commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      heartbeatIntervalMs:
        options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      reconnectBaseMs: options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxMs: options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS,
    })
  }

  start(): void {
    this.core.start()
  }

  close(): Promise<void> {
    return this.core.close()
  }

  whenReady(): Promise<void> {
    return runPromise(this.core.whenReady)
  }

  isReady(): boolean {
    return this.core.isReady()
  }

  onReady(callback: () => void): void {
    this.core.onReady(callback)
  }

  subscribe(
    message: Record<string, unknown>,
    onEvent: (message: HAIncomingMessage) => void,
  ): Promise<void> {
    return runPromise(this.core.subscribe(message, onEvent))
  }

  callService(
    domain: string,
    service: string,
    payload: Record<string, unknown> = {},
    options: { returnResponse?: boolean; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const message: Record<string, unknown> = {
      ...payload,
      type: 'call_service',
      domain,
      service,
    }
    if (options.returnResponse === true) {
      message['return_response'] = true
    }
    return runPromise(this.core.command(message, options.signal))
  }
}
