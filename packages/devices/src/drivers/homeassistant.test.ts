import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { HADriver, STATE_CACHE_TTL_MS } from './homeassistant.js'

function mockFetch(
  responseFactory: (url: string, init?: RequestInit) => Response,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      return responseFactory(url, init)
    }),
  )
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status })
}

const GLOBAL_CONFIG = { url: 'http://ha.local:8123', token: 'test-token-123' }

function makeDriver(): HADriver {
  return new HADriver()
}

async function initDriver(config = GLOBAL_CONFIG): Promise<HADriver> {
  const driver = makeDriver()
  await driver.init(config)
  return driver
}

function cacheSize(driver: HADriver): number {
  return (driver as unknown as { stateCache: Map<string, unknown> }).stateCache
    .size
}

describe('HADriver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('init', () => {
    it('should accept valid config', async () => {
      const driver = makeDriver()
      await expect(driver.init(GLOBAL_CONFIG)).resolves.toBeUndefined()
      expect(driver.name).toBe('homeassistant')
    })

    it('should throw without url', async () => {
      const driver = makeDriver()
      await expect(driver.init({ token: 'x' })).rejects.toThrow(/url/)
    })

    it('should throw without token', async () => {
      const driver = makeDriver()
      await expect(driver.init({ url: 'http://x' })).rejects.toThrow(/token/)
    })

    it('should throw with empty url', async () => {
      const driver = makeDriver()
      await expect(driver.init({ url: '', token: 'x' })).rejects.toThrow(/url/)
    })

    it('should strip trailing slashes from url', async () => {
      const driver = makeDriver()
      await driver.init({ url: 'http://ha.local:8123///', token: 'x' })
      mockFetch(url => {
        expect(url).toBe('http://ha.local:8123/api/states/switch.test')
        return jsonResponse({ state: 'on' })
      })
      await driver.getProperty('d1', 'power', {
        properties: { power: { entity: 'switch.test' } },
      })
    })
  })

  describe('getProperty', () => {
    it('should fetch entity state and parse on/off as boolean', async () => {
      mockFetch(url => {
        expect(url).toContain('/api/states/switch.test_power')
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'power', {
        properties: { power: { entity: 'switch.test_power' } },
      })

      expect(value).toBe(true)
    })

    it('should return false for off state', async () => {
      mockFetch(() => jsonResponse({ state: 'off', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'power', {
        properties: { power: { entity: 'switch.test' } },
      })

      expect(value).toBe(false)
    })

    it('should parse numeric state', async () => {
      mockFetch(() => jsonResponse({ state: '42.5', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'temperature', {
        properties: { temperature: { entity: 'sensor.temp' } },
      })

      expect(value).toBe(42.5)
    })

    it('should keep string state as-is when not parseable', async () => {
      mockFetch(() => jsonResponse({ state: 'idle', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'status', {
        properties: { status: { entity: 'sensor.status' } },
      })

      expect(value).toBe('idle')
    })

    it('should extract attribute when configured', async () => {
      mockFetch(() =>
        jsonResponse({
          state: 'on',
          attributes: { volume_level: 0.7, source: 'hdmi1' },
        }),
      )

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'volume', {
        properties: {
          volume: { entity: 'media_player.test', attribute: 'volume_level' },
        },
      })

      expect(value).toBe(0.7)
    })

    it('should return null for missing property config', async () => {
      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'unknown', {
        properties: {},
      })

      expect(value).toBeNull()
    })

    it('should return null when properties key is missing', async () => {
      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'power', {})

      expect(value).toBeNull()
    })

    it('should throw on HTTP error', async () => {
      mockFetch(() => textResponse('not found', 404))

      const driver = await initDriver()
      await expect(
        driver.getProperty('d1', 'power', {
          properties: { power: { entity: 'switch.missing' } },
        }),
      ).rejects.toThrow(/fetchState.*failed/)
    })

    it('should honor a nested get strategy on new-format property configs', async () => {
      mockFetch(url => {
        expect(url).toContain('/api/states/media_player.test')
        return jsonResponse({
          state: 'playing',
          attributes: { volume_level: 0.5 },
        })
      })

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'volume', {
        properties: {
          volume: {
            entity: 'media_player.test',
            get: { kind: 'attribute', attribute: 'volume_level' },
          },
        },
      })

      expect(value).toBe(0.5)
    })

    it('should default new-format properties to the state strategy', async () => {
      mockFetch(url => {
        expect(url).toContain('/api/states/switch.test')
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'power', {
        properties: {
          power: { entity: 'switch.test', set: { kind: 'inferred' } },
        },
      })

      expect(value).toBe(true)
    })

    it('should keep the flat attribute field as the get fallback on new-format properties', async () => {
      mockFetch(() =>
        jsonResponse({
          state: 'playing',
          attributes: { volume_level: 0.7 },
        }),
      )

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'volume', {
        properties: {
          volume: {
            entity: 'media_player.test',
            attribute: 'volume_level',
            set: {
              kind: 'service',
              service: 'media_player.volume_set',
              key: 'volume_level',
            },
          },
        },
      })

      expect(value).toBe(0.7)
    })
  })

  describe('getProperty — template strategy', () => {
    const templateConfig = (template: string) => ({
      properties: {
        label: { get: { kind: 'template', template } },
      },
    })

    it('should POST the template to /api/template and return the rendered text', async () => {
      mockFetch((url, init) => {
        expect(url).toBe('http://ha.local:8123/api/template')
        expect(init?.method).toBe('POST')
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer test-token-123',
        })
        expect(JSON.parse(String(init?.body))).toEqual({
          template: '{{ states("switch.test") }}',
        })
        return new Response('on', { status: 200 })
      })

      const driver = await initDriver()
      const value = await driver.getProperty(
        'd1',
        'label',
        templateConfig('{{ states("switch.test") }}'),
      )

      expect(value).toBe('on')
    })

    it('should cache template reads per program by template', async () => {
      const renderedTemplates: string[] = []
      mockFetch((url, init) => {
        expect(url).toBe('http://ha.local:8123/api/template')
        renderedTemplates.push(
          (JSON.parse(String(init?.body)) as { template: string }).template,
        )
        return new Response('rendered', { status: 200 })
      })

      const driver = await initDriver()
      const runtime = { programId: 'program-1' }

      const first = await driver.getProperty(
        'd1',
        'label',
        templateConfig('{{ a }}'),
        runtime,
      )
      const second = await driver.getProperty(
        'd1',
        'label',
        templateConfig('{{ a }}'),
        runtime,
      )
      const third = await driver.getProperty(
        'd1',
        'label',
        templateConfig('{{ b }}'),
        runtime,
      )

      expect(first).toBe('rendered')
      expect(second).toBe('rendered')
      expect(third).toBe('rendered')
      expect(renderedTemplates).toEqual(['{{ a }}', '{{ b }}'])
    })

    it('should refetch template reads when programId changes', async () => {
      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return new Response('rendered', { status: 200 })
      })

      const driver = await initDriver()
      const config = templateConfig('{{ a }}')

      await driver.getProperty('d1', 'label', config, {
        programId: 'program-1',
      })
      await driver.getProperty('d1', 'label', config, {
        programId: 'program-2',
      })

      expect(fetchCount).toBe(2)
    })

    it('should refetch once a template cache entry has expired', async () => {
      vi.useFakeTimers()
      try {
        let fetchCount = 0
        mockFetch(() => {
          fetchCount++
          return new Response('rendered', { status: 200 })
        })

        const driver = await initDriver()
        const config = templateConfig('{{ a }}')
        const runtime = { programId: 'program-1' }

        await driver.getProperty('d1', 'label', config, runtime)
        expect(fetchCount).toBe(1)

        vi.advanceTimersByTime(STATE_CACHE_TTL_MS + 1)

        await driver.getProperty('d1', 'label', config, runtime)
        expect(fetchCount).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should dedupe concurrent renders of the same template into one call', async () => {
      let fetchCount = 0
      mockFetch(async () => {
        fetchCount++
        await new Promise(resolve => setTimeout(resolve, 5))
        return new Response('rendered', { status: 200 })
      })

      const driver = await initDriver()
      const config = templateConfig('{{ a }}')

      const [first, second] = await Promise.all([
        driver.getProperty('d1', 'label', config),
        driver.getProperty('d1', 'label', config),
      ])

      expect(first).toBe('rendered')
      expect(second).toBe('rendered')
      expect(fetchCount).toBe(1)
    })

    it('should retry a template render after a concurrent failure', async () => {
      let calls = 0
      mockFetch(async () => {
        calls++
        if (calls === 1) return textResponse('boom', 500)
        return new Response('ok', { status: 200 })
      })

      const driver = await initDriver()
      const config = templateConfig('{{ a }}')

      const first = driver.getProperty('d1', 'label', config)
      const second = driver.getProperty('d1', 'label', config)
      await expect(first).rejects.toThrow(/renderTemplate failed/)
      await expect(second).rejects.toThrow(/renderTemplate failed/)

      const third = await driver.getProperty('d1', 'label', config)
      expect(third).toBe('ok')
      expect(calls).toBe(2)
    })

    it('should cache a joined render for the caller declaring a program', async () => {
      let fetchCount = 0
      mockFetch(async () => {
        fetchCount++
        await new Promise(resolve => setTimeout(resolve, 5))
        return new Response('rendered', { status: 200 })
      })

      const driver = await initDriver()
      const config = templateConfig('{{ a }}')

      const withoutRuntime = driver.getProperty('d1', 'label', config)
      const withRuntime = driver.getProperty('d1', 'label', config, {
        programId: 'program-1',
      })
      await Promise.all([withoutRuntime, withRuntime])
      expect(fetchCount).toBe(1)

      await driver.getProperty('d1', 'label', config, {
        programId: 'program-1',
      })
      expect(fetchCount).toBe(1)
    })

    it('should throw with the HA response body on template failure', async () => {
      mockFetch(() => textResponse('template error', 400))

      const driver = await initDriver()
      await expect(
        driver.getProperty('d1', 'label', templateConfig('{{ a }}')),
      ).rejects.toThrow(/renderTemplate failed for "{{ a }}".*template error/s)
    })
  })

  describe('getProperty — value mapping and coercion', () => {
    it('should translate a mapped HA value into the OpenNest value on get', async () => {
      mockFetch(() =>
        jsonResponse({
          state: 'cooling',
          attributes: { hvac_action: 'cooling' },
        }),
      )

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'hvac_mode', {
        properties: {
          hvac_mode: {
            type: 'string',
            values: ['auto', 'heat', 'cool', 'off'],
            entity: 'climate.salon',
            map: { cooling: 'cool', heating: 'heat' },
            get: { kind: 'attribute', attribute: 'hvac_action' },
            set: {
              kind: 'service',
              service: 'climate.set_hvac_mode',
              key: 'hvac_mode',
            },
          },
        },
      })

      expect(value).toBe('cool')
    })

    it('should pass an unmapped value through raw when values are not declared', async () => {
      mockFetch(() => jsonResponse({ state: 'auto', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'hvac_mode', {
        properties: {
          hvac_mode: {
            entity: 'climate.salon',
            map: { cooling: 'cool', heating: 'heat' },
            get: { kind: 'state' },
          },
        },
      })

      expect(value).toBe('auto')
    })

    it('should throw when the raw value misses the map and the declared values', async () => {
      mockFetch(() => jsonResponse({ state: 'warming', attributes: {} }))

      const driver = await initDriver()
      await expect(
        driver.getProperty('d1', 'hvac_mode', {
          properties: {
            hvac_mode: {
              type: 'string',
              values: ['cool', 'heat'],
              entity: 'climate.salon',
              map: { cooling: 'cool', heating: 'heat' },
              get: { kind: 'state' },
            },
          },
        }),
      ).rejects.toThrow(
        /HA get for device "d1", property "hvac_mode": value "warming" is not one of the declared values "cool", "heat"/,
      )
    })

    it('should throw when a typed get result violates the declared values', async () => {
      mockFetch(() => jsonResponse({ state: 'idle', attributes: {} }))

      const driver = await initDriver()
      await expect(
        driver.getProperty('d1', 'hvac_mode', {
          properties: {
            hvac_mode: {
              type: 'string',
              values: ['auto', 'off'],
              entity: 'climate.salon',
              get: { kind: 'state' },
            },
          },
        }),
      ).rejects.toThrow(/value "idle" is not one of the declared values/)
    })

    it('should keep string states unparsed when type string is declared', async () => {
      mockFetch(() => jsonResponse({ state: 'on', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'hvac_mode', {
        properties: {
          hvac_mode: {
            type: 'string',
            entity: 'climate.salon',
            get: { kind: 'state' },
          },
        },
      })

      expect(value).toBe('on')
    })

    it('should coerce on/off states when type boolean is declared', async () => {
      mockFetch(() => jsonResponse({ state: 'on', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'power', {
        properties: {
          power: {
            type: 'boolean',
            entity: 'switch.test',
            get: { kind: 'state' },
          },
        },
      })

      expect(value).toBe(true)
    })

    it('should keep the legacy heuristic for flat configs with a mistyped type', async () => {
      mockFetch(() => jsonResponse({ state: 'on', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'power', {
        properties: {
          power: { entity: 'switch.test', type: 'bool' },
        },
      })

      expect(value).toBe(true)
    })

    it('should coerce numeric states when type number is declared', async () => {
      mockFetch(() => jsonResponse({ state: '42.5', attributes: {} }))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'temperature', {
        properties: {
          temperature: {
            type: 'number',
            entity: 'sensor.temp',
            get: { kind: 'state' },
          },
        },
      })

      expect(value).toBe(42.5)
    })

    it('should throw on a state not coercible to the declared type', async () => {
      mockFetch(() => jsonResponse({ state: 'idle', attributes: {} }))

      const driver = await initDriver()
      await expect(
        driver.getProperty('d1', 'power', {
          properties: {
            power: {
              type: 'boolean',
              entity: 'switch.test',
              get: { kind: 'state' },
            },
          },
        }),
      ).rejects.toThrow(
        /HA get for device "d1", property "power": value "idle" is not coercible to the declared type "boolean"/,
      )
    })

    it('should coerce the rendered template text to the declared type', async () => {
      mockFetch((url, init) => {
        expect(url).toBe('http://ha.local:8123/api/template')
        expect(JSON.parse(String(init?.body))).toEqual({ template: '{{ x }}' })
        return textResponse(' 42.5\n', 200)
      })

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'temperature', {
        properties: {
          temperature: {
            type: 'number',
            get: { kind: 'template', template: '{{ x }}' },
          },
        },
      })

      expect(value).toBe(42.5)
    })

    it('should coerce an on/off template text when type boolean is declared', async () => {
      mockFetch(() => textResponse('off\n', 200))

      const driver = await initDriver()
      const value = await driver.getProperty('d1', 'power', {
        properties: {
          power: {
            type: 'boolean',
            get: { kind: 'template', template: '{{ states("switch.a") }}' },
          },
        },
      })

      expect(value).toBe(false)
    })
  })

  describe('getProperty — websocket strategies', () => {
    class ServiceWs {
      static instances: ServiceWs[] = []

      static reset(): void {
        ServiceWs.instances = []
      }

      static last(): ServiceWs {
        return ServiceWs.instances[ServiceWs.instances.length - 1]!
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
        ServiceWs.instances.push(this)
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

      connect(): void {
        this.serverOpen()
        this.serverMessage({ type: 'auth_required' })
        this.serverMessage({ type: 'auth_ok' })
      }

      subscribeId(): number | null {
        return this.lastMessageId('subscribe_entities')
      }

      callId(): number | null {
        return this.lastMessageId('call_service')
      }

      respond(id: number, result: unknown): void {
        this.serverMessage({ id, type: 'result', success: true, result })
      }

      errorRespond(id: number, code: string, message: string): void {
        this.serverMessage({
          id,
          type: 'result',
          success: false,
          error: { code, message },
        })
      }

      lastSent(): Record<string, unknown> {
        return JSON.parse(this.sent[this.sent.length - 1]!) as Record<
          string,
          unknown
        >
      }

      private lastMessageId(type: string): number | null {
        let id: number | null = null
        for (const raw of this.sent) {
          const message = JSON.parse(raw) as { type?: string; id?: number }
          if (message.type === type) id = message.id ?? null
        }
        return id
      }
    }

    afterEach(() => {
      ServiceWs.reset()
    })

    async function initServiceDriver(): Promise<{
      driver: HADriver
      ws: ServiceWs
    }> {
      const driver = makeDriver()
      await driver.init(GLOBAL_CONFIG)
      const ws = ServiceWs.last()
      ws.connect()
      await new Promise(resolve => setTimeout(resolve, 0))
      const subId = ws.subscribeId()
      expect(subId).not.toBeNull()
      ws.respond(subId!, null)
      return { driver, ws }
    }

    it('should return the script response variable over the websocket', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const { driver, ws } = await initServiceDriver()
      mockFetch(() => {
        throw new Error('no REST fallback for service responses')
      })

      const config = {
        properties: {
          summary: {
            get: { kind: 'script', script: 'script.daily_summary' },
          },
        },
      }
      const pending = driver.getProperty('d1', 'summary', config)

      const callId = ws.callId()
      expect(callId).not.toBeNull()
      expect(ws.lastSent()).toEqual({
        id: callId,
        type: 'call_service',
        domain: 'script',
        service: 'turn_on',
        entity_id: 'script.daily_summary',
        return_response: true,
      })
      ws.respond(callId!, { summary: { total: 3 } })

      await expect(pending).resolves.toEqual({ total: 3 })
      await driver.close()
    })

    it('should return the raw script response when it is not a single response variable', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const { driver, ws } = await initServiceDriver()

      const config = {
        properties: {
          summary: {
            get: { kind: 'script', script: 'script.daily_summary' },
          },
        },
      }
      const pending = driver.getProperty('d1', 'summary', config)
      ws.respond(ws.callId()!, { a: 1, b: 2 })

      await expect(pending).resolves.toEqual({ a: 1, b: 2 })
      await driver.close()
    })

    it('should call the declared service and return its response', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const { driver, ws } = await initServiceDriver()
      mockFetch(() => {
        throw new Error('no REST fallback for service responses')
      })

      const config = {
        properties: {
          forecast: {
            get: {
              kind: 'service_response',
              service: 'weather.get_forecasts',
              fields: { entity_id: 'weather.home' },
            },
          },
        },
      }
      const pending = driver.getProperty('d1', 'forecast', config)

      const callId = ws.callId()
      expect(callId).not.toBeNull()
      expect(ws.lastSent()).toEqual({
        id: callId,
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        entity_id: 'weather.home',
        return_response: true,
      })
      const response = { 'weather.home': { forecast: ['sunny'] } }
      ws.respond(callId!, response)

      await expect(pending).resolves.toEqual(response)
      await driver.close()
    })

    it('should translate a mapped script response on get', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const { driver, ws } = await initServiceDriver()

      const config = {
        properties: {
          hvac_mode: {
            entity: 'climate.salon',
            type: 'string',
            values: ['heat', 'cool'],
            map: { heating: 'heat', cooling: 'cool' },
            get: { kind: 'script', script: 'script.hvac_state' },
          },
        },
      }
      const pending = driver.getProperty('d1', 'hvac_mode', config)
      ws.respond(ws.callId()!, { mode: 'cooling' })

      await expect(pending).resolves.toBe('cool')
      await driver.close()
    })

    it('should coerce a service_response result to the declared type on get', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const { driver, ws } = await initServiceDriver()

      const config = {
        properties: {
          temperature: {
            type: 'number',
            get: {
              kind: 'service_response',
              service: 'weather.get_temperature',
            },
          },
        },
      }
      const pending = driver.getProperty('d1', 'temperature', config)
      ws.respond(ws.callId()!, '21.5')

      await expect(pending).resolves.toBe(21.5)
      await driver.close()
    })

    it('should throw an explicit error when the socket is down for a script get', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const driver = makeDriver()
      await driver.init(GLOBAL_CONFIG)
      mockFetch(() => {
        throw new Error('no REST fallback for service responses')
      })

      const config = {
        properties: {
          summary: {
            get: { kind: 'script', script: 'script.daily_summary' },
          },
        },
      }
      await expect(driver.getProperty('d1', 'summary', config)).rejects.toThrow(
        /strategy "script".*device "d1".*property "summary".*websocket.*not connected.*no REST fallback/s,
      )
      await driver.close()
    })

    it('should throw an explicit error when the socket is down for a service_response get', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const driver = makeDriver()
      await driver.init(GLOBAL_CONFIG)
      mockFetch(() => {
        throw new Error('no REST fallback for service responses')
      })

      const config = {
        properties: {
          forecast: {
            get: {
              kind: 'service_response',
              service: 'weather.get_forecasts',
            },
          },
        },
      }
      await expect(
        driver.getProperty('d1', 'forecast', config),
      ).rejects.toThrow(
        /strategy "service_response".*device "d1".*property "forecast".*websocket.*not connected/s,
      )
      await driver.close()
    })

    it('should wrap mid-flight ws failures with strategy/device/property context', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const { driver, ws } = await initServiceDriver()

      const config = {
        properties: {
          summary: {
            get: { kind: 'script', script: 'script.daily_summary' },
          },
        },
      }
      const pending = driver.getProperty('d1', 'summary', config)

      const callId = ws.callId()
      expect(callId).not.toBeNull()
      ws.errorRespond(callId!, 'unauthorized', 'connection lost')

      await expect(pending).rejects.toThrow(
        /strategy "script".*device "d1".*property "summary".*failed:.*connection lost/s,
      )
      await driver.close()
    })

    it('should call service_response get with empty fields payload when fields is absent', async () => {
      vi.stubGlobal('WebSocket', ServiceWs)
      const { driver, ws } = await initServiceDriver()
      mockFetch(() => {
        throw new Error('no REST fallback for service responses')
      })

      const config = {
        properties: {
          forecast: {
            get: {
              kind: 'service_response',
              service: 'weather.get_forecasts',
            },
          },
        },
      }
      const pending = driver.getProperty('d1', 'forecast', config)

      const callId = ws.callId()
      expect(callId).not.toBeNull()
      expect(ws.lastSent()).toEqual({
        id: callId,
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        return_response: true,
      })
      ws.respond(callId!, { 'weather.home': { forecast: ['sunny'] } })

      await expect(pending).resolves.toEqual({
        'weather.home': { forecast: ['sunny'] },
      })
      await driver.close()
    })
  })

  describe('per-program state caching', () => {
    const deviceConfig = {
      properties: { power: { entity: 'switch.test' } },
    }

    it('should fetch state once per entity within the same program', async () => {
      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const driver = await initDriver()
      const runtime = { programId: 'program-1' }

      const first = await driver.getProperty(
        'd1',
        'power',
        deviceConfig,
        runtime,
      )
      const second = await driver.getProperty(
        'd1',
        'power',
        deviceConfig,
        runtime,
      )

      expect(first).toBe(true)
      expect(second).toBe(true)
      expect(fetchCount).toBe(1)
    })

    it('should fetch again when programId changes', async () => {
      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const driver = await initDriver()

      await driver.getProperty('d1', 'power', deviceConfig, {
        programId: 'program-1',
      })
      await driver.getProperty('d1', 'power', deviceConfig, {
        programId: 'program-2',
      })

      expect(fetchCount).toBe(2)
    })

    it('should refetch once a cache entry has expired', async () => {
      vi.useFakeTimers()
      try {
        let fetchCount = 0
        mockFetch(() => {
          fetchCount++
          return jsonResponse({ state: 'on', attributes: {} })
        })

        const driver = await initDriver()
        const runtime = { programId: 'program-1' }

        await driver.getProperty('d1', 'power', deviceConfig, runtime)
        expect(fetchCount).toBe(1)

        vi.advanceTimersByTime(STATE_CACHE_TTL_MS + 1)

        await driver.getProperty('d1', 'power', deviceConfig, runtime)
        expect(fetchCount).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should serve a fresh cache entry without refetching', async () => {
      vi.useFakeTimers()
      try {
        let fetchCount = 0
        mockFetch(() => {
          fetchCount++
          return jsonResponse({ state: 'on', attributes: {} })
        })

        const driver = await initDriver()
        const runtime = { programId: 'program-1' }

        await driver.getProperty('d1', 'power', deviceConfig, runtime)
        vi.advanceTimersByTime(STATE_CACHE_TTL_MS - 1)
        await driver.getProperty('d1', 'power', deviceConfig, runtime)

        expect(fetchCount).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should refetch after setProperty invalidates the cache', async () => {
      let stateFetches = 0
      mockFetch(url => {
        if (url.includes('/states/')) {
          stateFetches++
          return jsonResponse({ state: 'on', attributes: {} })
        }
        return jsonResponse([])
      })

      const driver = await initDriver()
      const runtime = { programId: 'program-1' }

      await driver.getProperty('d1', 'power', deviceConfig, runtime)
      expect(stateFetches).toBe(1)

      await driver.setProperty('d1', 'power', true, deviceConfig)

      await driver.getProperty('d1', 'power', deviceConfig, runtime)
      expect(stateFetches).toBe(2)
    })

    it('should evict expired entries that are not re-read', async () => {
      vi.useFakeTimers()
      try {
        const fetchCounts: Record<string, number> = {}
        mockFetch(url => {
          const entityId = url.split('/states/')[1]!
          fetchCounts[entityId] = (fetchCounts[entityId] ?? 0) + 1
          return jsonResponse({ state: 'on', attributes: {} })
        })

        const driver = await initDriver()
        const runtime = { programId: 'program-1' }
        const deviceA = { properties: { power: { entity: 'switch.a' } } }
        const deviceB = { properties: { power: { entity: 'switch.b' } } }

        await driver.getProperty('d1', 'power', deviceA, runtime)
        await driver.getProperty('d2', 'power', deviceB, runtime)
        expect(cacheSize(driver)).toBe(2)

        vi.advanceTimersByTime(STATE_CACHE_TTL_MS + 1)

        await driver.getProperty('d1', 'power', deviceA, runtime)

        expect(fetchCounts['switch.a']).toBe(2)
        expect(fetchCounts['switch.b']).toBe(1)
        expect(cacheSize(driver)).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should refetch after executeAction invalidates the cache', async () => {
      let stateFetches = 0
      mockFetch(url => {
        if (url.includes('/states/')) {
          stateFetches++
          return jsonResponse({ state: 'on', attributes: {} })
        }
        return jsonResponse([])
      })

      const driver = await initDriver()
      const runtime = { programId: 'program-1' }
      const actionConfig = {
        actions: {
          play: {
            service: 'media_player.media_play',
            target: { entity_id: 'media_player.test' },
          },
        },
      }

      await driver.getProperty('d1', 'power', deviceConfig, runtime)
      expect(stateFetches).toBe(1)

      await driver.executeAction('d1', 'play', {}, actionConfig)

      await driver.getProperty('d1', 'power', deviceConfig, runtime)
      expect(stateFetches).toBe(2)
    })
  })

  describe('setProperty', () => {
    it('should call switch.turn_on for boolean true (inferred)', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) {
          return jsonResponse({ state: 'off' })
        }
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([{ entity_id: 'switch.test' }])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'power', true, {
        properties: { power: { entity: 'switch.test' } },
      })

      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain('/api/services/switch/turn_on')
      const body = JSON.parse(calls[0]!.body)
      expect(body.entity_id).toBe('switch.test')
    })

    it('should call switch.turn_off for boolean false (inferred)', async () => {
      const calls: { url: string }[] = []
      mockFetch(url => {
        if (url.includes('/states/')) return jsonResponse({ state: 'on' })
        calls.push({ url })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'power', false, {
        properties: { power: { entity: 'switch.test' } },
      })

      expect(calls[0]!.url).toContain('/api/services/switch/turn_off')
    })

    it('should infer light.turn_on for light domain', async () => {
      const calls: { url: string }[] = []
      mockFetch(url => {
        if (url.includes('/states/')) return jsonResponse({ state: 'off' })
        calls.push({ url })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'power', true, {
        properties: { power: { entity: 'light.salon' } },
      })

      expect(calls[0]!.url).toContain('/api/services/light/turn_on')
    })

    it('should use custom set_service with {value} template', async () => {
      const calls: { url: string }[] = []
      mockFetch(url => {
        if (url.includes('/states/')) return jsonResponse({ state: 'off' })
        calls.push({ url })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'power', false, {
        properties: {
          power: {
            entity: 'lock.porte',
            set_service: 'lock.{value}',
          },
        },
      })

      expect(calls[0]!.url).toContain('/api/services/lock/unlock')
    })

    it('should use explicit set_service without template for non-boolean', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: '50' })
        calls.push({ url: url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'volume', 75, {
        properties: {
          volume: {
            entity: 'media_player.test',
            set_service: 'media_player.volume_set',
            set_value_key: 'volume_level',
          },
        },
      })

      expect(calls[0]!.url).toContain('/api/services/media_player/volume_set')
      const body = JSON.parse(calls[0]!.body)
      expect(body.entity_id).toBe('media_player.test')
      expect(body.volume_level).toBe(75)
    })

    it('should use set_value_key in payload', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: 'hdmi1' })
        calls.push({ url: url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'source', 'hdmi2', {
        properties: {
          source: {
            entity: 'media_player.test',
            set_service: 'media_player.select_source',
            set_value_key: 'source',
          },
        },
      })

      const body = JSON.parse(calls[0]!.body)
      expect(body.source).toBe('hdmi2')
    })

    it('should be a no-op when property config is missing', async () => {
      mockFetch(() => jsonResponse([]))
      const driver = await initDriver()
      await expect(
        driver.setProperty('d1', 'unknown', true, { properties: {} }),
      ).resolves.toBeUndefined()
    })
  })

  describe('setProperty — set strategies', () => {
    it('should call the declared service with the value under the declared key', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: '50' })
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'volume', 75, {
        properties: {
          volume: {
            entity: 'media_player.test',
            set: {
              kind: 'service',
              service: 'media_player.volume_set',
              key: 'volume_level',
            },
          },
        },
      })

      expect(calls[0]!.url).toContain('/api/services/media_player/volume_set')
      const body = JSON.parse(calls[0]!.body)
      expect(body).toEqual({
        entity_id: 'media_player.test',
        volume_level: 75,
      })
    })

    it('should merge a declared target into the set service payload', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: '50' })
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'volume', 40, {
        properties: {
          volume: {
            entity: 'media_player.test',
            set: {
              kind: 'service',
              service: 'media_player.volume_set',
              key: 'volume_level',
              target: { entity_id: 'media_player.other' },
            },
          },
        },
      })

      const body = JSON.parse(calls[0]!.body)
      expect(body).toEqual({
        entity_id: 'media_player.other',
        volume_level: 40,
      })
    })

    it('should call the declared script with $value interpolated in fields', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: 'off' })
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'away', 'vacation', {
        properties: {
          away: {
            entity: 'climate.salon',
            set: {
              kind: 'script',
              script: 'script.set_away',
              fields: { mode: '$value', note: 'declared' },
            },
          },
        },
      })

      expect(calls[0]!.url).toContain('/api/services/script/turn_on')
      const body = JSON.parse(calls[0]!.body)
      expect(body).toEqual({
        entity_id: 'script.set_away',
        fields: { mode: 'vacation', note: 'declared' },
      })
    })

    describe('setProperty — value mapping', () => {
      const hvacConfig = {
        properties: {
          hvac_mode: {
            type: 'string',
            values: ['auto', 'heat', 'cool', 'off'],
            entity: 'climate.salon',
            map: { cooling: 'cool', heating: 'heat' },
            get: { kind: 'attribute', attribute: 'hvac_action' },
            set: {
              kind: 'service',
              service: 'climate.set_hvac_mode',
              key: 'hvac_mode',
            },
          },
        },
      }

      it('should write the inverse-mapped HA value for a bijective map', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((_url, init) => {
          calls.push({ url: _url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'hvac_mode', 'cool', hvacConfig)

        expect(calls[0]!.url).toContain('/api/services/climate/set_hvac_mode')
        const body = JSON.parse(calls[0]!.body)
        expect(body).toEqual({
          entity_id: 'climate.salon',
          hvac_mode: 'cooling',
        })
      })

      it('should round-trip a map whose targets need boolean coercion', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((url, init) => {
          if (url.includes('/states/')) {
            return jsonResponse({ state: 'on', attributes: {} })
          }
          calls.push({ url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        const config = {
          properties: {
            power: {
              type: 'boolean',
              entity: 'switch.salon',
              map: { on: 'true', off: 'false' },
              get: { kind: 'state' },
              set: {
                kind: 'service',
                service: 'switch.set_state',
                key: 'state',
              },
            },
          },
        }

        await expect(driver.getProperty('d1', 'power', config)).resolves.toBe(
          true,
        )
        await driver.setProperty('d1', 'power', true, config)

        expect(JSON.parse(calls[0]!.body).state).toBe('on')
      })

      it('should round-trip the HA 1/0 boolean convention through coercion', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((url, init) => {
          if (url.includes('/states/')) {
            return jsonResponse({ state: '1', attributes: {} })
          }
          calls.push({ url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        const config = {
          properties: {
            power: {
              type: 'boolean',
              entity: 'switch.salon',
              map: { '1': 'on', '0': 'off' },
              get: { kind: 'state' },
              set: {
                kind: 'service',
                service: 'switch.set_state',
                key: 'state',
              },
            },
          },
        }

        await expect(driver.getProperty('d1', 'power', config)).resolves.toBe(
          true,
        )
        await driver.setProperty('d1', 'power', true, config)

        expect(JSON.parse(calls[0]!.body).state).toBe('1')
      })

      it('should round-trip a map whose targets need number coercion', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((url, init) => {
          if (url.includes('/states/')) {
            return jsonResponse({ state: 'low', attributes: {} })
          }
          calls.push({ url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        const config = {
          properties: {
            level: {
              type: 'number',
              entity: 'sensor.salon',
              map: { low: '1', high: '2' },
              get: { kind: 'state' },
              set: {
                kind: 'service',
                service: 'sensor.set_level',
                key: 'level',
              },
            },
          },
        }

        await expect(driver.getProperty('d1', 'level', config)).resolves.toBe(1)
        await driver.setProperty('d1', 'level', 1, config)

        expect(JSON.parse(calls[0]!.body).level).toBe('low')
      })

      it('should write a value absent from the map unchanged', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((_url, init) => {
          calls.push({ url: _url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'hvac_mode', 'off', hvacConfig)

        const body = JSON.parse(calls[0]!.body)
        expect(body.hvac_mode).toBe('off')
      })

      it('should prefer the declared map_set over the automatic inverse', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((_url, init) => {
          calls.push({ url: _url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'hvac_mode', 'cool', {
          properties: {
            hvac_mode: {
              entity: 'climate.salon',
              map: { cooling: 'cool' },
              map_set: { cool: 'frost' },
              set: {
                kind: 'service',
                service: 'climate.set_hvac_mode',
                key: 'hvac_mode',
              },
            },
          },
        })

        const body = JSON.parse(calls[0]!.body)
        expect(body.hvac_mode).toBe('frost')
      })

      it('should throw when a set value is outside the declared map_set', async () => {
        const driver = await initDriver()
        await expect(
          driver.setProperty('d1', 'hvac_mode', 'turbo', {
            properties: {
              hvac_mode: {
                entity: 'climate.salon',
                map_set: { cool: 'cooling', heat: 'heating' },
                set: {
                  kind: 'service',
                  service: 'climate.set_hvac_mode',
                  key: 'hvac_mode',
                },
              },
            },
          }),
        ).rejects.toThrow(
          /HA set for device "d1", property "hvac_mode": value "turbo" is not in the declared set map \(map_set keys: "cool", "heat"\)/,
        )
      })

      it('should map the $value interpolated into set script fields', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((_url, init) => {
          calls.push({ url: _url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'hvac_mode', 'cool', {
          properties: {
            hvac_mode: {
              entity: 'climate.salon',
              map: { cooling: 'cool' },
              set: {
                kind: 'script',
                script: 'script.set_hvac',
                fields: { mode: '$value' },
              },
            },
          },
        })

        const body = JSON.parse(calls[0]!.body)
        expect(body.fields).toEqual({ mode: 'cooling' })
      })

      it('should not map the value when the set strategy does not write it', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((_url, init) => {
          calls.push({ url: _url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'hvac_mode', 'unmapped', {
          properties: {
            hvac_mode: {
              entity: 'climate.salon',
              map_set: { cool: 'cooling' },
              set: {
                kind: 'script',
                script: 'script.refresh',
                fields: { source: 'declared' },
              },
            },
          },
        })

        const body = JSON.parse(calls[0]!.body)
        expect(body.fields).toEqual({ source: 'declared' })
      })

      it('should map set values of legacy flat configs too', async () => {
        const calls: { url: string; body: string }[] = []
        mockFetch((_url, init) => {
          calls.push({ url: _url, body: init?.body?.toString() ?? '' })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'hvac_mode', 'cool', {
          properties: {
            hvac_mode: {
              entity: 'climate.salon',
              map: { cooling: 'cool' },
              set_service: 'climate.set_hvac_mode',
              set_value_key: 'hvac_mode',
            },
          },
        })

        const body = JSON.parse(calls[0]!.body)
        expect(body.hvac_mode).toBe('cooling')
      })

      it('should throw with the driver context on an ambiguous inverse map at runtime', async () => {
        const driver = await initDriver()
        await expect(
          driver.setProperty('d1', 'hvac_mode', 'cool', {
            properties: {
              hvac_mode: {
                entity: 'climate.salon',
                map: { cooling: 'cool', freezing: 'cool' },
                set_service: 'climate.set_hvac_mode',
                set_value_key: 'hvac_mode',
              },
            },
          }),
        ).rejects.toThrow(
          /value "cool" has an ambiguous inverse map \("cooling", "freezing" all map to it\); declare an explicit "map_set"/,
        )
      })
    })
  })

  describe('executeAction', () => {
    it('should call a service from action config', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: 'on' })
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.executeAction(
        'd1',
        'play',
        {},
        {
          actions: {
            play: {
              service: 'media_player.media_play',
              target: { entity_id: 'media_player.test' },
            },
          },
        },
      )

      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain('/api/services/media_player/media_play')
      const body = JSON.parse(calls[0]!.body)
      expect(body.entity_id).toBe('media_player.test')
    })

    it('should include data in service call payload', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        calls.push({ url: url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.executeAction(
        'd1',
        'set_volume',
        {},
        {
          actions: {
            set_volume: {
              service: 'media_player.volume_set',
              target: { entity_id: 'media_player.test' },
              data: { volume_level: 0.5 },
            },
          },
        },
      )

      const body = JSON.parse(calls[0]!.body)
      expect(body.entity_id).toBe('media_player.test')
      expect(body.volume_level).toBe(0.5)
    })

    it('should merge args into the service call payload', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.executeAction(
        'd1',
        'announce',
        { message: 'bonjour' },
        {
          actions: {
            announce: {
              service: 'tts.speak',
              target: { entity_id: 'media_player.test' },
            },
          },
        },
      )

      const body = JSON.parse(calls[0]!.body)
      expect(body.entity_id).toBe('media_player.test')
      expect(body.message).toBe('bonjour')
    })

    it('should be a no-op when action is not found', async () => {
      const driver = await initDriver()
      await expect(
        driver.executeAction('d1', 'unknown', {}, { actions: {} }),
      ).resolves.toBeUndefined()
    })

    it('should be a no-op when actions key is missing', async () => {
      const driver = await initDriver()
      await expect(
        driver.executeAction('d1', 'play', {}, {}),
      ).resolves.toBeUndefined()
    })
  })

  describe('executeAction — script strategy', () => {
    it('should call the declared script with the args interpolated in fields', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: 'on' })
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.executeAction(
        'd1',
        'boost',
        { minutes: 5 },
        {
          actions: {
            boost: {
              kind: 'script',
              script: 'script.boost',
              fields: { minutes: '$minutes', mode: 'turbo' },
            },
          },
        },
      )

      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toContain('/api/services/script/turn_on')
      const body = JSON.parse(calls[0]!.body)
      expect(body).toEqual({
        entity_id: 'script.boost',
        fields: { minutes: 5, mode: 'turbo' },
      })
    })

    it('should interpolate nested placeholders and omit missing optional args', async () => {
      const calls: { url: string; body: string }[] = []
      mockFetch((url, init) => {
        if (url.includes('/states/')) return jsonResponse({ state: 'on' })
        calls.push({ url, body: init?.body?.toString() ?? '' })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.executeAction(
        'd1',
        'boost',
        { minutes: 5 },
        {
          actions: {
            boost: {
              kind: 'script',
              script: 'script.boost',
              fields: {
                minutes: '$minutes',
                opts: { factor: '$factor', fixed: true },
              },
            },
          },
        },
      )

      const body = JSON.parse(calls[0]!.body)
      expect(body).toEqual({
        entity_id: 'script.boost',
        fields: { minutes: 5, opts: { fixed: true } },
      })
    })
  })

  describe('executeAction — argument validation', () => {
    const fetchSentinel = () => {
      mockFetch(() => {
        throw new Error('HA must not be called')
      })
    }

    it('should reject a missing required argument before any HA call', async () => {
      fetchSentinel()

      const driver = await initDriver()
      await expect(
        driver.executeAction(
          'd1',
          'boost',
          {},
          {
            actions: {
              boost: {
                kind: 'script',
                script: 'script.boost',
                fields: { minutes: '$minutes' },
                parameters: [
                  { name: 'minutes', type: 'number', required: true },
                ],
              },
            },
          },
        ),
      ).rejects.toThrow(
        /Missing argument "minutes".*action "boost".*device "d1".*required/s,
      )
    })

    it('should reject an argument outside the declared values', async () => {
      fetchSentinel()

      const driver = await initDriver()
      await expect(
        driver.executeAction(
          'd1',
          'set_mode',
          { mode: 'turbo' },
          {
            actions: {
              set_mode: {
                service: 'climate.set_operation_mode',
                parameters: [
                  { name: 'mode', type: 'enum', values: ['eco', 'boost'] },
                ],
              },
            },
          },
        ),
      ).rejects.toThrow(/must be one of "eco", "boost" \(got "turbo"\)/)
    })

    it('should reject an argument outside the declared range', async () => {
      fetchSentinel()

      const driver = await initDriver()
      await expect(
        driver.executeAction(
          'd1',
          'boost',
          { minutes: 120 },
          {
            actions: {
              boost: {
                kind: 'script',
                script: 'script.boost',
                fields: { minutes: '$minutes' },
                parameters: [
                  { name: 'minutes', type: 'number', range: [1, 60] },
                ],
              },
            },
          },
        ),
      ).rejects.toThrow(/must be between 1 and 60 \(got 120\)/)
    })

    it('should reject an argument with the wrong type', async () => {
      fetchSentinel()

      const driver = await initDriver()
      await expect(
        driver.executeAction(
          'd1',
          'announce',
          { message: 42 },
          {
            actions: {
              announce: {
                service: 'tts.speak',
                parameters: [{ name: 'message', type: 'string' }],
              },
            },
          },
        ),
      ).rejects.toThrow(/"message".*must be a string \(got 42\)/)
    })

    it('should accept declared arguments that satisfy the contract', async () => {
      const calls: { url: string }[] = []
      mockFetch(url => {
        if (url.includes('/states/')) return jsonResponse({ state: 'on' })
        calls.push({ url })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.executeAction(
        'd1',
        'boost',
        { on: true, minutes: 5 },
        {
          actions: {
            boost: {
              service: 'switch.turn_on',
              target: { entity_id: 'switch.test' },
              parameters: [
                { name: 'on', type: 'power', required: true },
                { name: 'minutes', type: 'number', range: [1, 60] },
              ],
            },
          },
        },
      )

      expect(calls).toHaveLength(1)
    })

    it('should validate args of legacy flat service actions too', async () => {
      fetchSentinel()

      const driver = await initDriver()
      await expect(
        driver.executeAction(
          'd1',
          'announce',
          {},
          {
            actions: {
              announce: {
                service: 'tts.speak',
                parameters: [{ name: 'message', required: true }],
              },
            },
          },
        ),
      ).rejects.toThrow(/Missing argument "message"/)
    })
  })

  describe('boolean inference for common domains', () => {
    const domains = ['switch', 'light', 'fan', 'automation', 'script']

    for (const domain of domains) {
      it(`should infer ${domain}.turn_on for true`, async () => {
        const calls: { url: string }[] = []
        mockFetch(url => {
          if (url.includes('/states/')) return jsonResponse({ state: 'off' })
          calls.push({ url })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'power', true, {
          properties: { power: { entity: `${domain}.test_dev` } },
        })

        expect(calls[0]!.url).toContain(`/api/services/${domain}/turn_on`)
      })

      it(`should infer ${domain}.turn_off for false`, async () => {
        const calls: { url: string }[] = []
        mockFetch(url => {
          if (url.includes('/states/')) return jsonResponse({ state: 'on' })
          calls.push({ url })
          return jsonResponse([])
        })

        const driver = await initDriver()
        await driver.setProperty('d1', 'power', false, {
          properties: { power: { entity: `${domain}.test_dev` } },
        })

        expect(calls[0]!.url).toContain(`/api/services/${domain}/turn_off`)
      })
    }

    it('should infer lock.lock for true on lock domain', async () => {
      const calls: { url: string }[] = []
      mockFetch(url => {
        if (url.includes('/states/')) return jsonResponse({ state: 'unlocked' })
        calls.push({ url })
        return jsonResponse([])
      })

      const driver = await initDriver()
      await driver.setProperty('d1', 'power', true, {
        properties: { power: { entity: 'lock.porte' } },
      })

      expect(calls[0]!.url).toContain('/api/services/lock/lock')
    })
  })

  describe('error handling', () => {
    it('should throw with error body on service call failure', async () => {
      mockFetch(() => textResponse('{"error":"invalid entity"}', 400))

      const driver = await initDriver()
      await expect(
        driver.setProperty('d1', 'power', true, {
          properties: { power: { entity: 'switch.invalid' } },
        }),
      ).rejects.toThrow(/callService.*failed/)
    })

    it('should throw on invalid service format in set_service', async () => {
      mockFetch(() => jsonResponse([]))
      const driver = await initDriver()

      await expect(
        driver.setProperty('d1', 'power', true, {
          properties: {
            power: {
              entity: 'switch.test',
              set_service: 'bad_format_no_dot',
            },
          },
        }),
      ).rejects.toThrow(/Invalid service format/)
    })
  })

  describe('validateDeviceConfig', () => {
    it('should reject an unknown get kind', () => {
      const driver = makeDriver()
      expect(() =>
        driver.validateDeviceConfig('d1', {
          properties: {
            power: {
              type: 'boolean',
              entity: 'switch.test',
              get: { kind: 'levitate' },
            },
          },
        }),
      ).toThrow(
        /Invalid HA binding for device "d1", property "power": unknown get kind "levitate"/,
      )
    })

    it('should reject a malformed set service', () => {
      const driver = makeDriver()
      expect(() =>
        driver.validateDeviceConfig('d1', {
          properties: {
            volume: {
              type: 'number',
              entity: 'media_player.test',
              set: { kind: 'service', service: 'volume_set' },
            },
          },
        }),
      ).toThrow(
        /device "d1", property "volume".*invalid service format "volume_set"/,
      )
    })

    it('should reject an orphan placeholder in an action', () => {
      const driver = makeDriver()
      expect(() =>
        driver.validateDeviceConfig('d1', {
          actions: {
            boost: {
              kind: 'script',
              script: 'script.boost',
              fields: { minutes: '$minuts' },
              parameters: [{ name: 'minutes' }],
            },
          },
        }),
      ).toThrow(/device "d1", action "boost".*orphan placeholder "\$minuts"/)
    })

    it('should reject an inevitable domain.unknown', () => {
      const driver = makeDriver()
      expect(() =>
        driver.validateDeviceConfig('d1', {
          properties: {
            volume: {
              type: 'number',
              entity: 'media_player.test',
              set: { kind: 'inferred' },
            },
          },
        }),
      ).toThrow(
        /property "volume".*set strategy "inferred".*media_player\.unknown/,
      )
    })

    it('should accept valid new format configs', () => {
      const driver = makeDriver()
      expect(() =>
        driver.validateDeviceConfig('d1', {
          properties: {
            power: {
              type: 'boolean',
              entity: 'switch.test',
              get: { kind: 'state' },
              set: { kind: 'inferred' },
            },
            away: {
              set: {
                kind: 'script',
                script: 'script.set_away',
                fields: { mode: '$value' },
              },
            },
          },
          actions: {
            boost: {
              kind: 'script',
              script: 'script.boost',
              fields: { minutes: '$minutes' },
              parameters: [{ name: 'minutes', type: 'number' }],
            },
            play: {
              kind: 'service',
              service: 'media_player.media_play',
              target: { entity_id: 'media_player.test' },
            },
          },
        }),
      ).not.toThrow()
    })

    it('should leave old flat format configs unvalidated', () => {
      const driver = makeDriver()
      expect(() =>
        driver.validateDeviceConfig('d1', {
          properties: {
            power: { entity: 'switch.test' },
            broken: {
              entity: 'switch.test',
              set_service: 'bad_format_no_dot',
            },
          },
          actions: {
            play: { service: 'media_player.media_play' },
          },
        }),
      ).not.toThrow()
    })
  })

  describe('websocket lifecycle', () => {
    class LifecycleWs {
      static instances: LifecycleWs[] = []

      static reset(): void {
        LifecycleWs.instances = []
      }

      static last(): LifecycleWs {
        return LifecycleWs.instances[LifecycleWs.instances.length - 1]!
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
        LifecycleWs.instances.push(this)
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

      lastSent(): Record<string, unknown> {
        return JSON.parse(this.sent[this.sent.length - 1]!) as Record<
          string,
          unknown
        >
      }
    }

    afterEach(() => {
      LifecycleWs.reset()
    })

    it('should start the websocket client with the derived url on init', async () => {
      vi.stubGlobal('WebSocket', LifecycleWs)
      const driver = makeDriver()
      await driver.init(GLOBAL_CONFIG)

      const ws = LifecycleWs.last()
      expect(ws.url).toBe('ws://ha.local:8123/api/websocket')

      ws.serverOpen()
      ws.serverMessage({ type: 'auth_required' })
      expect(ws.lastSent()).toEqual({
        type: 'auth',
        access_token: 'test-token-123',
      })
      ws.serverMessage({ type: 'auth_ok' })
      await driver.close()
    })

    it('should normalize trailing slashes and derive wss from https', async () => {
      vi.stubGlobal('WebSocket', LifecycleWs)
      const driver = makeDriver()
      await driver.init({ url: 'https://ha.local:8123///', token: 'x' })

      expect(LifecycleWs.last().url).toBe('wss://ha.local:8123/api/websocket')
      await driver.close()
    })

    it('should close the websocket client on driver close', async () => {
      vi.stubGlobal('WebSocket', LifecycleWs)
      const driver = makeDriver()
      await driver.init(GLOBAL_CONFIG)
      const ws = LifecycleWs.last()
      ws.serverOpen()
      ws.serverMessage({ type: 'auth_required' })
      ws.serverMessage({ type: 'auth_ok' })

      await driver.close()
      expect(ws.readyState).toBe(3)
      await expect(driver.close()).resolves.toBeUndefined()
    })
  })

  describe('realtime state store', () => {
    class RealtimeWs {
      static instances: RealtimeWs[] = []

      static reset(): void {
        RealtimeWs.instances = []
      }

      static last(): RealtimeWs {
        return RealtimeWs.instances[RealtimeWs.instances.length - 1]!
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
        RealtimeWs.instances.push(this)
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

      connect(): void {
        this.serverOpen()
        this.serverMessage({ type: 'auth_required' })
        this.serverMessage({ type: 'auth_ok' })
      }

      subscribeId(): number | null {
        for (const raw of this.sent) {
          const message = JSON.parse(raw) as { type?: string; id?: number }
          if (message.type === 'subscribe_entities') {
            return message.id ?? null
          }
        }
        return null
      }

      addEntities(
        id: number,
        entities: Record<string, Record<string, unknown>>,
      ): void {
        this.serverMessage({ id, type: 'result', success: true, result: null })
        this.serverMessage({ id, type: 'event', event: { a: entities } })
      }

      changeEntities(
        id: number,
        changes: Record<string, Record<string, unknown>>,
      ): void {
        this.serverMessage({ id, type: 'event', event: { c: changes } })
      }

      removeEntities(id: number, entityIds: string[]): void {
        this.serverMessage({ id, type: 'event', event: { r: entityIds } })
      }
    }

    afterEach(() => {
      RealtimeWs.reset()
    })

    async function initRealtimeDriver(): Promise<{
      driver: HADriver
      ws: RealtimeWs
      subId: number
    }> {
      const driver = makeDriver()
      await driver.init(GLOBAL_CONFIG)
      const ws = RealtimeWs.last()
      ws.connect()
      await new Promise(resolve => setTimeout(resolve, 0))
      const subId = ws.subscribeId()
      expect(subId).not.toBeNull()
      return { driver, ws, subId: subId! }
    }

    const deviceConfig = {
      properties: { power: { entity: 'switch.test' } },
    }

    function compressed(
      state: string,
      attributes: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return { s: state, a: attributes, c: 'ctx-1', lc: 1000, lu: 1000 }
    }

    it('should serve the next get from the store after a push update without fetching', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, { 'switch.test': compressed('off') })

      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return jsonResponse({ state: 'off', attributes: {} })
      })

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(false)

      ws.changeEntities(subId, {
        'switch.test': { '+': { s: 'on', lc: 2000, lu: 2000 } },
      })

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      expect(fetchCount).toBe(0)
      await driver.close()
    })

    it('should merge attribute changes and removals from change deltas', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, {
        'media_player.test': compressed('playing', { volume_level: 0.7 }),
      })

      mockFetch(() => {
        throw new Error('REST fallback should not be used')
      })

      const config = {
        properties: {
          volume: { entity: 'media_player.test', attribute: 'volume_level' },
          source: { entity: 'media_player.test', attribute: 'source' },
        },
      }

      expect(await driver.getProperty('d1', 'volume', config)).toBe(0.7)

      ws.changeEntities(subId, {
        'media_player.test': {
          '+': { a: { volume_level: 0.9 } },
          '-': { a: ['source'] },
        },
      })

      expect(await driver.getProperty('d1', 'volume', config)).toBe(0.9)
      expect(await driver.getProperty('d1', 'source', config)).toBeNull()
      await driver.close()
    })

    it('should drop removed entities from the store and fall back to REST', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, { 'switch.test': compressed('off') })

      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(false)
      expect(fetchCount).toBe(0)

      ws.removeEntities(subId, ['switch.test'])

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      expect(fetchCount).toBe(1)
      await driver.close()
    })

    it('should fall back to REST when the socket is down', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, { 'switch.test': compressed('off') })

      let fetchCount = 0
      mockFetch(() => {
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(false)
      expect(fetchCount).toBe(0)

      ws.close()

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      expect(fetchCount).toBe(1)
      await driver.close()
    })

    it('should fall back to REST when the entity is missing from the store', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, { 'switch.other': compressed('off') })

      mockFetch(() => jsonResponse({ state: 'on', attributes: {} }))

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      await driver.close()
    })

    it('should store unavailable and unknown states as-is', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, { 'switch.test': compressed('unavailable') })

      mockFetch(() => {
        throw new Error('REST fallback should not be used')
      })

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(
        'unavailable',
      )

      ws.changeEntities(subId, {
        'switch.test': { '+': { s: 'unknown' } },
      })

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(
        'unknown',
      )
      await driver.close()
    })

    it('should not serve a stale store value after setProperty', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, { 'switch.test': compressed('off') })

      mockFetch(url => {
        if (url.includes('/states/')) {
          return jsonResponse({ state: 'on', attributes: {} })
        }
        return jsonResponse([])
      })

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(false)

      await driver.setProperty('d1', 'power', true, deviceConfig)

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      await driver.close()
    })

    it('should keep unrelated store entries after setProperty', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, {
        'switch.test': compressed('off'),
        'switch.other': compressed('on'),
      })

      let fetchCount = 0
      mockFetch(url => {
        if (!url.includes('/states/')) return jsonResponse([])
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      await driver.setProperty('d1', 'power', true, deviceConfig)

      const otherConfig = {
        properties: { power: { entity: 'switch.other' } },
      }
      expect(await driver.getProperty('d1', 'power', otherConfig)).toBe(true)
      expect(fetchCount).toBe(0)
      await driver.close()
    })

    it('should not serve a stale store value after executeAction', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, {
        'switch.test': compressed('off'),
        'switch.other': compressed('on'),
      })

      let fetchCount = 0
      mockFetch(url => {
        if (!url.includes('/states/')) return jsonResponse([])
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const actionConfig = {
        actions: {
          boost: {
            service: 'switch.turn_on',
            target: { entity_id: 'switch.test' },
          },
        },
      }

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(false)

      await driver.executeAction('d1', 'boost', {}, actionConfig)

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      expect(fetchCount).toBe(1)

      const otherConfig = {
        properties: { power: { entity: 'switch.other' } },
      }
      expect(await driver.getProperty('d1', 'power', otherConfig)).toBe(true)
      expect(fetchCount).toBe(1)
      await driver.close()
    })

    it('should clear the whole store after a set by script (unknown scope)', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, {
        'switch.test': compressed('off'),
        'switch.other': compressed('on'),
      })

      let fetchCount = 0
      mockFetch(url => {
        if (!url.includes('/states/')) return jsonResponse([])
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const scriptConfig = {
        properties: {
          power: {
            entity: 'switch.test',
            set: {
              kind: 'script',
              script: 'script.set_power',
              fields: { state: '$value' },
            },
          },
        },
      }
      const otherConfig = {
        properties: { power: { entity: 'switch.other' } },
      }

      await driver.setProperty('d1', 'power', true, scriptConfig)

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      expect(await driver.getProperty('d1', 'power', otherConfig)).toBe(true)
      expect(fetchCount).toBe(2)
      await driver.close()
    })

    it('should drop the declared target entities of a set service call', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, {
        'switch.test': compressed('off'),
        'switch.other': compressed('on'),
      })

      let fetchCount = 0
      mockFetch(url => {
        if (!url.includes('/states/')) return jsonResponse([])
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const targetConfig = {
        properties: {
          power: {
            entity: 'switch.test',
            set: {
              kind: 'service',
              service: 'switch.turn_on',
              target: { entity_id: 'switch.other' },
            },
          },
        },
      }
      const otherConfig = {
        properties: { power: { entity: 'switch.other' } },
      }

      await driver.setProperty('d1', 'power', true, targetConfig)

      expect(await driver.getProperty('d1', 'power', otherConfig)).toBe(true)
      expect(fetchCount).toBe(1)
      await driver.close()
    })

    it('should clear the whole store after an action by script (unknown scope)', async () => {
      vi.stubGlobal('WebSocket', RealtimeWs)
      const { driver, ws, subId } = await initRealtimeDriver()
      ws.addEntities(subId, {
        'switch.test': compressed('off'),
        'switch.other': compressed('on'),
      })

      let fetchCount = 0
      mockFetch(url => {
        if (!url.includes('/states/')) return jsonResponse([])
        fetchCount++
        return jsonResponse({ state: 'on', attributes: {} })
      })

      const scriptAction = {
        actions: {
          boost: {
            kind: 'script',
            script: 'script.boost',
            fields: { minutes: '$minutes' },
          },
        },
      }
      const otherConfig = {
        properties: { power: { entity: 'switch.other' } },
      }

      await driver.executeAction('d1', 'boost', { minutes: 5 }, scriptAction)

      expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
      expect(await driver.getProperty('d1', 'power', otherConfig)).toBe(true)
      expect(fetchCount).toBe(2)
      await driver.close()
    })

    it('should re-subscribe and rebuild the store after a reconnection', async () => {
      vi.useFakeTimers()
      try {
        vi.stubGlobal('WebSocket', RealtimeWs)
        const driver = makeDriver()
        await driver.init(GLOBAL_CONFIG)
        const ws = RealtimeWs.last()
        ws.connect()
        await vi.advanceTimersByTimeAsync(0)
        const subId = ws.subscribeId()
        expect(subId).not.toBeNull()
        ws.addEntities(subId!, { 'switch.test': compressed('off') })

        ws.close()
        await vi.advanceTimersByTimeAsync(1000)

        const ws2 = RealtimeWs.last()
        expect(ws2).not.toBe(ws)
        ws2.connect()
        await vi.advanceTimersByTimeAsync(0)
        const subId2 = ws2.subscribeId()
        expect(subId2).not.toBeNull()
        expect(subId2).not.toBe(subId)
        ws2.addEntities(subId2!, { 'switch.test': compressed('on') })

        let fetchCount = 0
        mockFetch(() => {
          fetchCount++
          return jsonResponse({ state: 'on', attributes: {} })
        })

        expect(await driver.getProperty('d1', 'power', deviceConfig)).toBe(true)
        expect(fetchCount).toBe(0)
        await driver.close()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
