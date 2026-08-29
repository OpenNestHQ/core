import { describe, it, expect, vi, afterEach } from 'vitest'
import { HAWebSocketClient, HAWsAuthError } from './ws.js'

const URL = 'ws://ha.local:8123/api/websocket'
const TOKEN = 'tok-123'

class MockWebSocket {
  static instances: MockWebSocket[] = []

  static reset(): void {
    MockWebSocket.instances = []
  }

  static last(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]!
  }

  readonly url: string
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  serverOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }

  serverMessage(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  serverError(): void {
    this.onerror?.()
  }

  lastSent(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]!) as Record<
      string,
      unknown
    >
  }
}

type ClientOptions = Partial<ConstructorParameters<typeof HAWebSocketClient>[0]>

async function startHandshake(options: ClientOptions = {}): Promise<{
  client: HAWebSocketClient
  ready: Promise<void>
  ws: MockWebSocket
}> {
  const client = new HAWebSocketClient({ url: URL, token: TOKEN, ...options })
  const ready = client.whenReady()
  client.start()
  const ws = MockWebSocket.last()
  ws.serverOpen()
  ws.serverMessage({ type: 'auth_required' })
  return { client, ready, ws }
}

async function connectClient(
  options: ClientOptions = {},
): Promise<{ client: HAWebSocketClient; ws: MockWebSocket }> {
  const { client, ready, ws } = await startHandshake(options)
  ws.serverMessage({ type: 'auth_ok' })
  await ready
  return { client, ws }
}

describe('HAWebSocketClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    MockWebSocket.reset()
  })

  describe('auth handshake', () => {
    it('should complete the auth handshake and send the token', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ready, ws } = await startHandshake()

      expect(ws.url).toBe(URL)
      expect(ws.sent).toHaveLength(1)
      expect(ws.lastSent()).toEqual({ type: 'auth', access_token: TOKEN })

      ws.serverMessage({ type: 'auth_ok' })
      await expect(ready).resolves.toBeUndefined()
      await client.close()
    })

    it('should reject with a clear error on auth_invalid', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { ready } = await startHandshake()

      MockWebSocket.last().serverMessage({
        type: 'auth_invalid',
        message: 'Invalid access token',
      })

      const error = await ready.catch((err: unknown) => err)
      expect(error).toBeInstanceOf(HAWsAuthError)
      expect((error as Error).message).toContain('auth_invalid')
      expect((error as Error).message).toContain('Invalid access token')
    })

    it('should not reconnect after an auth_invalid rejection', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { ready } = await startHandshake()
      MockWebSocket.last().serverMessage({ type: 'auth_invalid' })
      await expect(ready).rejects.toThrow(/auth_invalid/)

      await new Promise(resolve => setTimeout(resolve, 20))
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('should reject when the socket fails during the handshake', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { ready } = await startHandshake()

      MockWebSocket.last().serverError()

      await expect(ready).rejects.toThrow(/connection failed/)
    })

    it('should reject whenReady after the client is closed', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ws } = await connectClient()

      await client.close()
      expect(ws.readyState).toBe(3)
      await expect(client.whenReady()).rejects.toThrow(/closed/)
    })
  })
})
