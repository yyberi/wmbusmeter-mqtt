import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { resolveTelegramTopic } from "../src/mqttClient.js";
import { parseWmbusLine } from "../src/wmbusProcess.js";
import type { WmbusTelegram } from "../src/types.js";
import { baseEnv } from "./config.test.js";

describe("payload routing", () => {
  const config = loadConfig(baseEnv());

  it("routes heat payloads to the heat topic", () => {
    const payload: Partial<WmbusTelegram> = {
      media: "heat",
      meter: "kamheat",
      name: "kaukolampo",
      id: "85231646",
    };

    expect(resolveTelegramTopic(payload, config)).toBe("wmbus/kaukolampo/state");
  });

  it('routes cold water payloads to the water topic', () => {
    const payload: Partial<WmbusTelegram> = {
      media: "cold water",
      meter: "kamwater",
      name: "vesi",
      id: "76822855",
    };

    expect(resolveTelegramTopic(payload, config)).toBe("wmbus/vesi/state");
  });

  it("routes unknown payloads to the raw topic", () => {
    const payload: Partial<WmbusTelegram> = {
      media: "electricity",
      meter: "unknown",
      name: "other",
      id: "12345678",
    };

    expect(resolveTelegramTopic(payload, config)).toBe("wmbus/raw");
  });
});

describe("parseWmbusLine", () => {
  it("returns undefined for invalid JSON without throwing", () => {
    expect(() => parseWmbusLine("{not-json")).not.toThrow();
    expect(parseWmbusLine("{not-json")).toBeUndefined();
  });

  it("ignores non-JSON lines", () => {
    expect(parseWmbusLine("started wmbusmeters")).toBeUndefined();
  });

  it("accepts valid JSON with at least one meter identity field", () => {
    expect(parseWmbusLine('{"id":"85231646","value":1}')).toEqual({
      id: "85231646",
      value: 1,
    });
  });
});
