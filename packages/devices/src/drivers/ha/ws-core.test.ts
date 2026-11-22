import { describe, it, expect, vi, afterEach } from 'vitest'
import { Effect, Fiber } from 'effect'
import { makeHAWsCore } from './ws-core.js'
import type { HAIncomingMessage } from './ws-core.js'

class FakeWebSocket {
  static last: FakeWebSocket | undefined

  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.last = this
  }

  send(): void {}

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  serverMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

describe('makeHAWsCore subscribe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWebSocket.last = undefined
  })

  it('should drop an interrupted subscription so its events are ignored', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const core = makeHAWsCore({
      url: 'ws://ha.local:8123/api/websocket',
      token: 'tok',
      commandTimeoutMs: 60_000,
      heartbeatIntervalMs: 60_000,
      reconnectBaseMs: 10,
      reconnectMaxMs: 10,
    })
    const ready = Effect.runPromise(core.whenReady)
    core.start()
    const ws = FakeWebSocket.last!
    ws.readyState = 1
    ws.onopen?.()
    ws.serverMessage({ type: 'auth_required' })
    ws.serverMessage({ type: 'auth_ok' })
    await ready

    const events: HAIncomingMessage[] = []
    const fiber = Effect.runFork(
      core.subscribe({ type: 'subscribe_entities' }, message => {
        events.push(message)
      }),
    )
    await Effect.runPromise(Effect.yieldNow)
    await Effect.runPromise(Fiber.interrupt(fiber))

    ws.serverMessage({ id: 1, type: 'event', event: { add: {} } })
    expect(events).toHaveLength(0)
    await core.close()
  })
})
