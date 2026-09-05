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

export interface HAIncomingMessage {
  type: string
  id?: number
  success?: boolean
  result?: unknown
  error?: { code: string; message: string }
  message?: string
  event?: unknown
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

interface QueuedCommand {
  start: () => void
  reject: (error: Error) => void
}

interface Subscription {
  onEvent: (message: HAIncomingMessage) => void
  ack: (error?: Error) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

type WsState = 'idle' | 'connecting' | 'ready' | 'stopped'

export function toHaWsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/^http/, 'ws')}/api/websocket`
}

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
  private nextId = 1
  private attempts = 0

  private readonly pending = new Map<number, PendingCommand>()
  private readonly subscriptions = new Map<number, Subscription>()
  private readonly queue: QueuedCommand[] = []
  private readonly readyWaiters: Array<(error?: Error) => void> = []
  private readonly readyCallbacks: Array<() => void> = []
  private readonly closeWaiters: Array<() => void> = []
  private connectFail: ((error: Error) => void) | null = null
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
    this.fatalError = null
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

  isReady(): boolean {
    return this.state === 'ready'
  }

  onReady(callback: () => void): void {
    this.readyCallbacks.push(callback)
  }

  subscribe(
    message: Record<string, unknown>,
    onEvent: (message: HAIncomingMessage) => void,
  ): Promise<void> {
    const ws = this.ws
    if (!ws || this.state !== 'ready') {
      return Promise.reject(new Error('HA websocket is not connected'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const subscription: Subscription = {
        onEvent,
        timer: undefined,
        ack: (error?: Error) => {
          if (subscription.timer !== undefined) {
            clearTimeout(subscription.timer)
            subscription.timer = undefined
          }
          if (error) {
            this.subscriptions.delete(id)
            reject(error)
          } else {
            resolve()
          }
        },
      }
      subscription.timer = setTimeout(() => {
        subscription.ack(
          new Error(
            `HA websocket command "${String(message['type'])}" timed out after ${this.commandTimeoutMs}ms`,
          ),
        )
      }, this.commandTimeoutMs)
      unrefTimer(subscription.timer)
      this.subscriptions.set(id, subscription)
      try {
        ws.send(JSON.stringify({ id, ...message }))
      } catch (error) {
        subscription.ack(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    })
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectAndAuth()
        if (this.stopped) return
        this.attempts = 0
        this.state = 'ready'
        this.notifyReady()
        this.startHeartbeat()
        this.flushQueue()
        await this.awaitClose()
      } catch (error) {
        if (error instanceof HAWsAuthError) {
          this.fail(error)
          return
        }
      } finally {
        this.stopHeartbeat()
      }
      if (this.stopped) return
      const delay = Math.min(
        this.reconnectBaseMs * 2 ** this.attempts,
        this.reconnectMaxMs,
      )
      this.attempts++
      await Promise.race([sleep(delay), this.awaitClose()])
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
        this.connectFail = null
        reject(error)
      }
      this.connectFail = fail

      ws.onmessage = event => {
        if (this.authenticated) {
          this.routeMessage(event.data)
          return
        }
        const message = parseMessage(event.data)
        if (!message) return
        if (message.type === 'auth_required') {
          try {
            ws.send(JSON.stringify({ type: 'auth', access_token: this.token }))
          } catch {
            fail(new Error('HA websocket connection lost during auth'))
          }
          return
        }
        if (message.type === 'auth_ok') {
          this.authenticated = true
          settled = true
          this.connectFail = null
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
        if (this.state === 'ready') this.state = 'connecting'
        fail(new Error('HA websocket connection closed during handshake'))
        this.rejectPending(new Error('HA websocket connection lost'))
        this.clearSubscriptions(new Error('HA websocket connection lost'))
        this.notifyClosed()
      }
    })
  }

  async callService(
    domain: string,
    service: string,
    payload: Record<string, unknown> = {},
    options: { returnResponse?: boolean } = {},
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
    return this.command(message)
  }

  private command(message: Record<string, unknown>): Promise<unknown> {
    if (this.stopped) {
      return Promise.reject(
        this.fatalError ?? new Error('HA websocket client is closed'),
      )
    }
    if (this.state === 'ready') {
      return this.send(message)
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        start: () => {
          this.send(message).then(resolve, reject)
        },
        reject,
      })
    })
  }

  private send(message: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws
    if (!ws || this.state !== 'ready') {
      return Promise.reject(new Error('HA websocket is not connected'))
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const pending: PendingCommand = { resolve, reject, timer: undefined }
      pending.timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new Error(
            `HA websocket command "${String(message['type'])}" timed out after ${this.commandTimeoutMs}ms`,
          ),
        )
      }, this.commandTimeoutMs)
      unrefTimer(pending.timer)
      this.pending.set(id, pending)
      try {
        ws.send(JSON.stringify({ id, ...message }))
      } catch (error) {
        this.pending.delete(id)
        this.clearPendingTimer(pending)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private flushQueue(): void {
    for (const queued of this.queue.splice(0)) {
      queued.start()
    }
  }

  private rejectQueue(error: Error): void {
    for (const queued of this.queue.splice(0)) {
      queued.reject(error)
    }
  }

  private teardown(reason: Error, fatal: boolean): void {
    this.stopped = true
    this.state = 'stopped'
    if (fatal) this.fatalError = reason
    this.stopHeartbeat()
    this.rejectReadyWaiters(reason)
    this.rejectQueue(reason)
    // In-flight commands never see an onclose here (teardownSocket detaches
    // the handlers first), so they must be rejected explicitly or they would
    // pend until their own timeout.
    this.rejectPending(reason)
    this.clearSubscriptions(reason)
    this.teardownSocket()
    const connectFail = this.connectFail
    this.connectFail = null
    connectFail?.(reason)
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

  private routeMessage(data: unknown): void {
    const message = parseMessage(data)
    if (!message || message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (pending) {
      this.pending.delete(message.id)
      this.clearPendingTimer(pending)
      if (message.type === 'result') {
        if (message.success === true) {
          pending.resolve(message.result)
        } else {
          pending.reject(commandError(message))
        }
        return
      }
      pending.resolve(message)
      return
    }
    const subscription = this.subscriptions.get(message.id)
    if (!subscription) return
    if (message.type === 'result') {
      if (message.success === true) {
        subscription.ack()
      } else {
        subscription.ack(commandError(message))
      }
      return
    }
    subscription.onEvent(message)
  }

  private clearSubscriptions(error: Error): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.ack(error)
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      this.clearPendingTimer(pending)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private clearPendingTimer(pending: PendingCommand): void {
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer)
      pending.timer = undefined
    }
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
    for (const callback of this.readyCallbacks) callback()
    for (const waiter of this.readyWaiters.splice(0)) waiter()
  }

  private rejectReadyWaiters(error: Error): void {
    for (const waiter of this.readyWaiters.splice(0)) waiter(error)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' }).catch(() => this.forceClose())
    }, this.heartbeatIntervalMs)
    unrefTimer(this.heartbeatTimer)
  }

  private forceClose(): void {
    this.ws?.close()
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

function commandError(message: HAIncomingMessage): Error {
  const code = message.error?.code ?? 'unknown_error'
  const detail = message.error?.message ?? 'no details'
  return new Error(`HA websocket command failed: ${code} — ${detail}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    unrefTimer(timer)
  })
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const t = timer as { unref?: () => void }
  if (typeof t.unref === 'function') {
    t.unref()
  }
}
