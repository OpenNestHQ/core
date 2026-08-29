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

  serverClose(): void {
    this.readyState = 3
    this.onclose?.()
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

    it('should retry when the socket fails during the handshake', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const client = new HAWebSocketClient({
          url: URL,
          token: TOKEN,
          reconnectBaseMs: 1000,
        })
        const ready = client.whenReady()
        client.start()

        MockWebSocket.last().serverError()
        await vi.advanceTimersByTimeAsync(1000)
        expect(MockWebSocket.instances).toHaveLength(2)

        const ws2 = MockWebSocket.last()
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        ws2.serverMessage({ type: 'auth_ok' })

        await expect(ready).resolves.toBeUndefined()
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should reject whenReady after the client is closed', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ws } = await connectClient()

      await client.close()
      expect(ws.readyState).toBe(3)
      await expect(client.whenReady()).rejects.toThrow(/closed/)
    })
  })

  describe('callService', () => {
    it('should send a call_service command and resolve with the result', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ws } = await connectClient()

      const result = client.callService('switch', 'turn_on', {
        entity_id: 'switch.test',
      })
      expect(ws.lastSent()).toEqual({
        id: 1,
        type: 'call_service',
        domain: 'switch',
        service: 'turn_on',
        entity_id: 'switch.test',
      })
      expect('return_response' in ws.lastSent()).toBe(false)

      ws.serverMessage({ id: 1, type: 'result', success: true, result: null })
      await expect(result).resolves.toBeNull()
      await client.close()
    })

    it('should request and resolve the service response with returnResponse', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ws } = await connectClient()

      const result = client.callService(
        'weather',
        'get_forecasts',
        { entity_id: 'weather.home' },
        { returnResponse: true },
      )
      expect(ws.lastSent()).toMatchObject({
        id: 1,
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        entity_id: 'weather.home',
        return_response: true,
      })

      const response = { 'weather.home': { forecast: [] } }
      ws.serverMessage({
        id: 1,
        type: 'result',
        success: true,
        result: response,
      })
      await expect(result).resolves.toEqual(response)
      await client.close()
    })

    it('should reject with the error code and message on failure', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ws } = await connectClient()

      const result = client.callService('switch', 'turn_on', {})
      ws.serverMessage({
        id: 1,
        type: 'result',
        success: false,
        error: { code: 'unknown_service', message: 'Service not found' },
      })

      await expect(result).rejects.toThrow(
        /unknown_service.*Service not found/s,
      )
      await client.close()
    })

    it('should reject cleanly when the response times out', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient({ commandTimeoutMs: 5000 })

        const result = client.callService('switch', 'turn_on', {})
        const expectation = expect(result).rejects.toThrow(
          /timed out after 5000ms/,
        )
        await vi.advanceTimersByTimeAsync(5000)
        await expectation

        expect(ws.sent).toHaveLength(2)
        expect(ws.lastSent()).toMatchObject({ id: 1, type: 'call_service' })
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should correlate responses by command id', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ws } = await connectClient()

      const first = client.callService('switch', 'turn_on', {})
      const second = client.callService('light', 'turn_off', {})

      ws.serverMessage({
        id: 2,
        type: 'result',
        success: true,
        result: 'second',
      })
      ws.serverMessage({
        id: 1,
        type: 'result',
        success: true,
        result: 'first',
      })

      await expect(first).resolves.toBe('first')
      await expect(second).resolves.toBe('second')
      await client.close()
    })

    it('should queue callService issued before the first connection', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const client = new HAWebSocketClient({ url: URL, token: TOKEN })
      const result = client.callService('switch', 'turn_on', {
        entity_id: 'switch.test',
      })
      client.start()

      const ws = MockWebSocket.last()
      ws.serverOpen()
      ws.serverMessage({ type: 'auth_required' })
      ws.serverMessage({ type: 'auth_ok' })
      await Promise.resolve()

      expect(ws.lastSent()).toMatchObject({
        id: 1,
        type: 'call_service',
        domain: 'switch',
        service: 'turn_on',
        entity_id: 'switch.test',
      })
      ws.serverMessage({ id: 1, type: 'result', success: true, result: null })
      await expect(result).resolves.toBeNull()
      await client.close()
    })

    it('should reject callService after the client is closed', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client } = await connectClient()
      await client.close()

      await expect(client.callService('switch', 'turn_on', {})).rejects.toThrow(
        /closed/,
      )
    })
  })

  describe('command queue', () => {
    it('should flush commands queued during a reconnection on the new socket', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient({ reconnectBaseMs: 1000 })

        ws.serverClose()
        const result = client.callService(
          'weather',
          'get_forecasts',
          { entity_id: 'weather.home' },
          { returnResponse: true },
        )
        await vi.advanceTimersByTimeAsync(1000)

        const ws2 = MockWebSocket.last()
        expect(ws2).not.toBe(ws)
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        ws2.serverMessage({ type: 'auth_ok' })
        await Promise.resolve()

        expect(ws2.lastSent()).toMatchObject({
          id: 1,
          type: 'call_service',
          domain: 'weather',
          service: 'get_forecasts',
          entity_id: 'weather.home',
          return_response: true,
        })

        const response = { 'weather.home': { forecast: [] } }
        ws2.serverMessage({
          id: 1,
          type: 'result',
          success: true,
          result: response,
        })
        await expect(result).resolves.toEqual(response)
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should keep queue order across multiple queued commands', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient({ reconnectBaseMs: 1000 })

        ws.serverClose()
        const first = client.callService('switch', 'turn_on', {})
        const second = client.callService('light', 'turn_off', {})

        await vi.advanceTimersByTimeAsync(1000)
        const ws2 = MockWebSocket.last()
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        ws2.serverMessage({ type: 'auth_ok' })
        await Promise.resolve()

        expect(ws2.sent.slice(1)).toHaveLength(2)
        expect(JSON.parse(ws2.sent[1]!)).toMatchObject({ id: 1 })
        expect(JSON.parse(ws2.sent[2]!)).toMatchObject({ id: 2 })

        ws2.serverMessage({ id: 1, type: 'result', success: true, result: 'a' })
        ws2.serverMessage({ id: 2, type: 'result', success: true, result: 'b' })
        await expect(first).resolves.toBe('a')
        await expect(second).resolves.toBe('b')
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should reject queued commands when the client is closed', async () => {
      vi.stubGlobal('WebSocket', MockWebSocket)
      const { client, ws } = await connectClient()

      ws.serverClose()
      const result = client.callService('switch', 'turn_on', {})
      await client.close()

      await expect(result).rejects.toThrow(/closed/)
    })

    it('should reject queued commands when re-auth is refused', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient({ reconnectBaseMs: 1000 })

        ws.serverClose()
        const result = client.callService('switch', 'turn_on', {})

        await vi.advanceTimersByTimeAsync(1000)
        const ws2 = MockWebSocket.last()
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        ws2.serverMessage({
          type: 'auth_invalid',
          message: 'Invalid access token',
        })

        await expect(result).rejects.toThrow(/Invalid access token/)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('reconnection and heartbeat', () => {
    it('should reconnect with backoff and re-authenticate after a disconnect', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient()

        ws.serverClose()
        await vi.advanceTimersByTimeAsync(999)
        expect(MockWebSocket.instances).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(1)
        expect(MockWebSocket.instances).toHaveLength(2)

        const ws2 = MockWebSocket.last()
        expect(ws2).not.toBe(ws)
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        expect(ws2.lastSent()).toEqual({
          type: 'auth',
          access_token: TOKEN,
        })
        ws2.serverMessage({ type: 'auth_ok' })

        await expect(client.whenReady()).resolves.toBeUndefined()
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should grow the backoff exponentially up to the cap', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client } = await connectClient({
          reconnectBaseMs: 1000,
          reconnectMaxMs: 3000,
        })

        MockWebSocket.last().serverClose()
        await vi.advanceTimersByTimeAsync(1000)
        expect(MockWebSocket.instances).toHaveLength(2)
        MockWebSocket.last().serverError()

        await vi.advanceTimersByTimeAsync(1999)
        expect(MockWebSocket.instances).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(MockWebSocket.instances).toHaveLength(3)
        MockWebSocket.last().serverError()

        await vi.advanceTimersByTimeAsync(2999)
        expect(MockWebSocket.instances).toHaveLength(3)
        await vi.advanceTimersByTimeAsync(1)
        expect(MockWebSocket.instances).toHaveLength(4)
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should reset the backoff after a successful reconnection', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client } = await connectClient({ reconnectBaseMs: 1000 })

        MockWebSocket.last().serverClose()
        await vi.advanceTimersByTimeAsync(1000)
        const ws2 = MockWebSocket.last()
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        ws2.serverMessage({ type: 'auth_ok' })
        await client.whenReady()

        ws2.serverClose()
        await vi.advanceTimersByTimeAsync(1000)
        expect(MockWebSocket.instances).toHaveLength(3)
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should send a heartbeat ping and survive the pong', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient()

        await vi.advanceTimersByTimeAsync(30_000)
        expect(ws.lastSent()).toMatchObject({ id: 1, type: 'ping' })
        ws.serverMessage({ id: 1, type: 'pong' })

        await vi.advanceTimersByTimeAsync(30_000)
        expect(ws.lastSent()).toMatchObject({ id: 2, type: 'ping' })
        ws.serverMessage({ id: 2, type: 'pong' })

        await vi.advanceTimersByTimeAsync(30_000)
        expect(MockWebSocket.instances).toHaveLength(1)
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should reconnect when a heartbeat ping goes unanswered', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient({
          commandTimeoutMs: 5000,
          heartbeatIntervalMs: 10_000,
          reconnectBaseMs: 1000,
        })

        await vi.advanceTimersByTimeAsync(10_000)
        expect(ws.lastSent()).toMatchObject({ type: 'ping' })

        await vi.advanceTimersByTimeAsync(5000)
        await vi.advanceTimersByTimeAsync(1000)

        expect(MockWebSocket.instances).toHaveLength(2)
        const ws2 = MockWebSocket.last()
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        ws2.serverMessage({ type: 'auth_ok' })
        await expect(client.whenReady()).resolves.toBeUndefined()
        await client.close()
      } finally {
        vi.useRealTimers()
      }
    })

    it('should close cleanly while waiting in the backoff', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient()

        ws.serverClose()
        const closing = client.close()
        await vi.advanceTimersByTimeAsync(0)

        await expect(closing).resolves.toBeUndefined()
        expect(MockWebSocket.instances).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should stop retrying and reject commands when re-auth is refused', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', MockWebSocket)
        const { client, ws } = await connectClient()

        ws.serverClose()
        await vi.advanceTimersByTimeAsync(1000)

        const ws2 = MockWebSocket.last()
        ws2.serverOpen()
        ws2.serverMessage({ type: 'auth_required' })
        ws2.serverMessage({
          type: 'auth_invalid',
          message: 'Invalid access token',
        })

        await vi.advanceTimersByTimeAsync(60_000)
        expect(MockWebSocket.instances).toHaveLength(2)

        await expect(
          client.callService('switch', 'turn_on', {}),
        ).rejects.toThrow(/Invalid access token/)
        await expect(client.whenReady()).rejects.toThrow(/Invalid access token/)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
