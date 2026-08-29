export class HAWsAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HAWsAuthError'
  }
}

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

interface HAIncomingMessage {
  type: string
  id?: number
  success?: boolean
  result?: unknown
  error?: { code: string; message: string }
  message?: string
}

type WsState = 'idle' | 'connecting' | 'ready' | 'stopped'

export class HAWebSocketClient {
  private readonly url: string
  private readonly token: string
  private readonly commandTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number

  private ws: WebSocket | null = null
  private state: WsState = 'idle'
  private authenticated = false
  private stopped = false
  private fatalError: Error | null = null
  private loop: Promise<void> | null = null

  private readonly readyWaiters: Array<(error?: Error) => void> = []
  private readonly closeWaiters: Array<() => void> = []
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(options: HAWebSocketClientOptions) {
    this.url = options.url
    this.token = options.token
    this.commandTimeoutMs =
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS
  }

  start(): void {
    if (this.loop) return
    this.stopped = false
    this.loop = this.runLoop().catch(() => {})
  }

  async close(): Promise<void> {
    if (!this.stopped) {
      this.teardown(new Error('HA websocket client is closed'), false)
    }
    await this.loop?.catch(() => {})
  }

  whenReady(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve()
    if (this.fatalError) return Promise.reject(this.fatalError)
    if (this.stopped) {
      return Promise.reject(new Error('HA websocket client is closed'))
    }
    return new Promise((resolve, reject) => {
      this.readyWaiters.push(error => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private async runLoop(): Promise<void> {
    try {
      await this.connectAndAuth()
      this.state = 'ready'
      this.notifyReady()
      await this.awaitClose()
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error
          : new Error('HA websocket connection failed'),
      )
    }
  }

  private connectAndAuth(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.state = 'connecting'
      this.authenticated = false
      let settled = false
      const ws = new WebSocket(this.url)
      this.ws = ws

      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }

      ws.onmessage = event => {
        if (this.authenticated) return
        const message = parseMessage(event.data)
        if (!message) return
        if (message.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: this.token }))
          return
        }
        if (message.type === 'auth_ok') {
          this.authenticated = true
          settled = true
          resolve()
          return
        }
        if (message.type === 'auth_invalid') {
          fail(
            new HAWsAuthError(
              `HA websocket auth failed (auth_invalid): ${message.message ?? 'no details'}`,
            ),
          )
        }
      }
      ws.onerror = () => {
        fail(new Error(`HA websocket connection failed: ${this.url}`))
      }
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null
        fail(new Error('HA websocket connection closed during handshake'))
        this.notifyClosed()
      }
    })
  }

  private teardown(reason: Error, fatal: boolean): void {
    this.stopped = true
    this.state = 'stopped'
    if (fatal) this.fatalError = reason
    this.stopHeartbeat()
    this.rejectReadyWaiters(reason)
    this.teardownSocket()
    this.notifyClosed()
  }

  private fail(error: Error): void {
    if (this.stopped) return
    this.teardown(error, true)
  }

  private teardownSocket(): void {
    const ws = this.ws
    this.ws = null
    this.authenticated = false
    if (!ws) return
    ws.onmessage = null
    ws.onerror = null
    ws.onclose = null
    ws.close()
  }

  private awaitClose(): Promise<void> {
    return new Promise(resolve => {
      this.closeWaiters.push(resolve)
    })
  }

  private notifyClosed(): void {
    for (const notify of this.closeWaiters.splice(0)) notify()
  }

  private notifyReady(): void {
    for (const waiter of this.readyWaiters.splice(0)) waiter()
  }

  private rejectReadyWaiters(error: Error): void {
    for (const waiter of this.readyWaiters.splice(0)) waiter(error)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }
}

function parseMessage(data: unknown): HAIncomingMessage | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const message = parsed as HAIncomingMessage
  if (typeof message.type !== 'string') return null
  return message
}
