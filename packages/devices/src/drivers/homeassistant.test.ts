import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { HADriver } from "./homeassistant.js";

function mockFetch(responseFactory: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    return responseFactory(url, init);
  }));
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

const GLOBAL_CONFIG = { url: "http://ha.local:8123", token: "test-token-123" };

function makeDriver(): HADriver {
  return new HADriver();
}

async function initDriver(config = GLOBAL_CONFIG): Promise<HADriver> {
  const driver = makeDriver();
  await driver.init(config);
  return driver;
}

describe("HADriver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("init", () => {
    it("should accept valid config", async () => {
      const driver = makeDriver();
      await expect(driver.init(GLOBAL_CONFIG)).resolves.toBeUndefined();
      expect(driver.name).toBe("homeassistant");
    });

    it("should throw without url", async () => {
      const driver = makeDriver();
      await expect(driver.init({ token: "x" })).rejects.toThrow(/url/);
    });

    it("should throw without token", async () => {
      const driver = makeDriver();
      await expect(driver.init({ url: "http://x" })).rejects.toThrow(/token/);
    });

    it("should throw with empty url", async () => {
      const driver = makeDriver();
      await expect(driver.init({ url: "", token: "x" })).rejects.toThrow(/url/);
    });

    it("should strip trailing slashes from url", async () => {
      const driver = makeDriver();
      await driver.init({ url: "http://ha.local:8123///", token: "x" });
      mockFetch((url) => {
        expect(url).toBe("http://ha.local:8123/api/states/switch.test");
        return jsonResponse({ state: "on" });
      });
      await driver.getProperty("d1", "power", {
        properties: { power: { entity: "switch.test" } },
      });
    });
  });

  describe("getProperty", () => {
    it("should fetch entity state and parse on/off as boolean", async () => {
      mockFetch((url) => {
        expect(url).toContain("/api/states/switch.test_power");
        return jsonResponse({ state: "on", attributes: {} });
      });

      const driver = await initDriver();
      const value = await driver.getProperty("d1", "power", {
        properties: { power: { entity: "switch.test_power" } },
      });

      expect(value).toBe(true);
    });

    it("should return false for off state", async () => {
      mockFetch(() => jsonResponse({ state: "off", attributes: {} }));

      const driver = await initDriver();
      const value = await driver.getProperty("d1", "power", {
        properties: { power: { entity: "switch.test" } },
      });

      expect(value).toBe(false);
    });

    it("should parse numeric state", async () => {
      mockFetch(() => jsonResponse({ state: "42.5", attributes: {} }));

      const driver = await initDriver();
      const value = await driver.getProperty("d1", "temperature", {
        properties: { temperature: { entity: "sensor.temp" } },
      });

      expect(value).toBe(42.5);
    });

    it("should keep string state as-is when not parseable", async () => {
      mockFetch(() => jsonResponse({ state: "idle", attributes: {} }));

      const driver = await initDriver();
      const value = await driver.getProperty("d1", "status", {
        properties: { status: { entity: "sensor.status" } },
      });

      expect(value).toBe("idle");
    });

    it("should extract attribute when configured", async () => {
      mockFetch(() =>
        jsonResponse({
          state: "on",
          attributes: { volume_level: 0.7, source: "hdmi1" },
        }),
      );

      const driver = await initDriver();
      const value = await driver.getProperty("d1", "volume", {
        properties: {
          volume: { entity: "media_player.test", attribute: "volume_level" },
        },
      });

      expect(value).toBe(0.7);
    });

    it("should return null for missing property config", async () => {
      const driver = await initDriver();
      const value = await driver.getProperty("d1", "unknown", {
        properties: {},
      });

      expect(value).toBeNull();
    });

    it("should return null when properties key is missing", async () => {
      const driver = await initDriver();
      const value = await driver.getProperty("d1", "power", {});

      expect(value).toBeNull();
    });

    it("should throw on HTTP error", async () => {
      mockFetch(() => textResponse("not found", 404));

      const driver = await initDriver();
      await expect(
        driver.getProperty("d1", "power", {
          properties: { power: { entity: "switch.missing" } },
        }),
      ).rejects.toThrow(/fetchState.*failed/);
    });
  });

  describe("setProperty", () => {
    it("should call switch.turn_on for boolean true (inferred)", async () => {
      const calls: { url: string; body: string }[] = [];
      mockFetch((url, init) => {
        if (url.includes("/states/")) {
          return jsonResponse({ state: "off" });
        }
        calls.push({ url, body: init?.body?.toString() ?? "" });
        return jsonResponse([{ entity_id: "switch.test" }]);
      });

      const driver = await initDriver();
      await driver.setProperty("d1", "power", true, {
        properties: { power: { entity: "switch.test" } },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/api/services/switch/turn_on");
      const body = JSON.parse(calls[0]!.body);
      expect(body.entity_id).toBe("switch.test");
    });

    it("should call switch.turn_off for boolean false (inferred)", async () => {
      const calls: { url: string }[] = [];
      mockFetch((url, init) => {
        if (url.includes("/states/")) return jsonResponse({ state: "on" });
        calls.push({ url });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.setProperty("d1", "power", false, {
        properties: { power: { entity: "switch.test" } },
      });

      expect(calls[0]!.url).toContain("/api/services/switch/turn_off");
    });

    it("should infer light.turn_on for light domain", async () => {
      const calls: { url: string }[] = [];
      mockFetch((url, init) => {
        if (url.includes("/states/")) return jsonResponse({ state: "off" });
        calls.push({ url });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.setProperty("d1", "power", true, {
        properties: { power: { entity: "light.salon" } },
      });

      expect(calls[0]!.url).toContain("/api/services/light/turn_on");
    });

    it("should use custom set_service with {value} template", async () => {
      const calls: { url: string }[] = [];
      mockFetch((url) => {
        if (url.includes("/states/")) return jsonResponse({ state: "off" });
        calls.push({ url });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.setProperty("d1", "power", false, {
        properties: {
          power: {
            entity: "lock.porte",
            set_service: "lock.{value}",
          },
        },
      });

      expect(calls[0]!.url).toContain("/api/services/lock/unlock");
    });

    it("should use explicit set_service without template for non-boolean", async () => {
      const calls: { url: string; body: string }[] = [];
      mockFetch((url, init) => {
        if (url.includes("/states/")) return jsonResponse({ state: "50" });
        calls.push({ url: url, body: init?.body?.toString() ?? "" });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.setProperty("d1", "volume", 75, {
        properties: {
          volume: {
            entity: "media_player.test",
            set_service: "media_player.volume_set",
            set_value_key: "volume_level",
          },
        },
      });

      expect(calls[0]!.url).toContain("/api/services/media_player/volume_set");
      const body = JSON.parse(calls[0]!.body);
      expect(body.entity_id).toBe("media_player.test");
      expect(body.volume_level).toBe(75);
    });

    it("should use set_value_key in payload", async () => {
      const calls: { url: string; body: string }[] = [];
      mockFetch((url, init) => {
        if (url.includes("/states/")) return jsonResponse({ state: "hdmi1" });
        calls.push({ url: url, body: init?.body?.toString() ?? "" });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.setProperty("d1", "source", "hdmi2", {
        properties: {
          source: {
            entity: "media_player.test",
            set_service: "media_player.select_source",
            set_value_key: "source",
          },
        },
      });

      const body = JSON.parse(calls[0]!.body);
      expect(body.source).toBe("hdmi2");
    });

    it("should be a no-op when property config is missing", async () => {
      mockFetch(() => jsonResponse([]));
      const driver = await initDriver();
      await expect(
        driver.setProperty("d1", "unknown", true, { properties: {} }),
      ).resolves.toBeUndefined();
    });
  });

  describe("executeAction", () => {
    it("should call a service from action config", async () => {
      const calls: { url: string; body: string }[] = [];
      mockFetch((url, init) => {
        if (url.includes("/states/")) return jsonResponse({ state: "on" });
        calls.push({ url, body: init?.body?.toString() ?? "" });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.executeAction("d1", "play", {
        actions: {
          play: {
            service: "media_player.media_play",
            target: { entity_id: "media_player.test" },
          },
        },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/api/services/media_player/media_play");
      const body = JSON.parse(calls[0]!.body);
      expect(body.entity_id).toBe("media_player.test");
    });

    it("should include data in service call payload", async () => {
      const calls: { url: string; body: string }[] = [];
      mockFetch((url, init) => {
        calls.push({ url: url, body: init?.body?.toString() ?? "" });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.executeAction("d1", "set_volume", {
        actions: {
          set_volume: {
            service: "media_player.volume_set",
            target: { entity_id: "media_player.test" },
            data: { volume_level: 0.5 },
          },
        },
      });

      const body = JSON.parse(calls[0]!.body);
      expect(body.entity_id).toBe("media_player.test");
      expect(body.volume_level).toBe(0.5);
    });

    it("should be a no-op when action is not found", async () => {
      const driver = await initDriver();
      await expect(
        driver.executeAction("d1", "unknown", { actions: {} }),
      ).resolves.toBeUndefined();
    });

    it("should be a no-op when actions key is missing", async () => {
      const driver = await initDriver();
      await expect(
        driver.executeAction("d1", "play", {}),
      ).resolves.toBeUndefined();
    });
  });

  describe("boolean inference for common domains", () => {
    const domains = ["switch", "light", "fan", "automation", "script"];

    for (const domain of domains) {
      it(`should infer ${domain}.turn_on for true`, async () => {
        const calls: { url: string }[] = [];
        mockFetch((url) => {
          if (url.includes("/states/")) return jsonResponse({ state: "off" });
          calls.push({ url });
          return jsonResponse([]);
        });

        const driver = await initDriver();
        await driver.setProperty("d1", "power", true, {
          properties: { power: { entity: `${domain}.test_dev` } },
        });

        expect(calls[0]!.url).toContain(`/api/services/${domain}/turn_on`);
      });

      it(`should infer ${domain}.turn_off for false`, async () => {
        const calls: { url: string }[] = [];
        mockFetch((url) => {
          if (url.includes("/states/")) return jsonResponse({ state: "on" });
          calls.push({ url });
          return jsonResponse([]);
        });

        const driver = await initDriver();
        await driver.setProperty("d1", "power", false, {
          properties: { power: { entity: `${domain}.test_dev` } },
        });

        expect(calls[0]!.url).toContain(`/api/services/${domain}/turn_off`);
      });
    }

    it("should infer lock.lock for true on lock domain", async () => {
      const calls: { url: string }[] = [];
      mockFetch((url) => {
        if (url.includes("/states/")) return jsonResponse({ state: "unlocked" });
        calls.push({ url });
        return jsonResponse([]);
      });

      const driver = await initDriver();
      await driver.setProperty("d1", "power", true, {
        properties: { power: { entity: "lock.porte" } },
      });

      expect(calls[0]!.url).toContain("/api/services/lock/lock");
    });
  });

  describe("error handling", () => {
    it("should throw with error body on service call failure", async () => {
      mockFetch(() => textResponse('{"error":"invalid entity"}', 400));

      const driver = await initDriver();
      await expect(
        driver.setProperty("d1", "power", true, {
          properties: { power: { entity: "switch.invalid" } },
        }),
      ).rejects.toThrow(/callService.*failed/);
    });

    it("should throw on invalid service format in set_service", async () => {
      mockFetch(() => jsonResponse([]));
      const driver = await initDriver();

      await expect(
        driver.setProperty("d1", "power", true, {
          properties: {
            power: {
              entity: "switch.test",
              set_service: "bad_format_no_dot",
            },
          },
        }),
      ).rejects.toThrow(/Invalid service format/);
    });
  });
});
