import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads and validates a simulation config", () => {
    const config = loadConfig(baseEnv());

    expect(config.simulate).toBe(true);
    expect(config.mqtt.qos).toBe(0);
    expect(config.watchdogTimeoutMs).toBe(900000);
    expect(config.heatMeter.id).toBe("85231646");
    expect(config.homeAssistant.discoveryEnabled).toBe(false);
  });

  it("rejects placeholder keys when SIMULATE=false", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        SIMULATE: "false",
        HEAT_METER_KEY: "replace_with_heat_meter_dek",
        WATER_METER_KEY: "replace_with_water_meter_dek",
      }),
    ).toThrow(/HEAT_METER_KEY/);
  });

  it("rejects invalid MQTT_QOS values", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        MQTT_QOS: "3",
      }),
    ).toThrow(/MQTT_QOS/);
  });

  it("rejects non-numeric MQTT_PORT values", () => {
    expect(() =>
      loadConfig({
        ...baseEnv(),
        MQTT_PORT: "not-a-number",
      }),
    ).toThrow(/MQTT_PORT/);
  });

  it("loads Home Assistant discovery settings from env", () => {
    const config = loadConfig({
      ...baseEnv(),
      HA_DISCOVERY_ENABLED: "true",
      HA_DISCOVERY_PREFIX: "ha",
      HA_DISCOVERY_RETAIN: "false",
      HA_DEVICE_MANUFACTURER: "Kamstrup Custom",
    });

    expect(config.homeAssistant).toEqual({
      discoveryEnabled: true,
      discoveryPrefix: "ha",
      discoveryRetain: false,
      deviceManufacturer: "Kamstrup Custom",
    });
  });
});

export function baseEnv(): Record<string, string> {
  return {
    SIMULATE: "true",
    SIMULATION_INTERVAL_MS: "10000",
    WATCHDOG_TIMEOUT_MS: "900000",
    RESTART_DELAY_MS: "5000",
    WMBUS_COMMAND: "wmbusmeters",
    WMBUS_DEVICE: "/dev/ttyACM0:iu891a:c1,t1",
    HEAT_METER_NAME: "kaukolampo",
    HEAT_METER_DRIVER: "kamheat",
    HEAT_METER_ID: "85231646",
    HEAT_METER_KEY: "replace_with_heat_meter_dek",
    WATER_METER_NAME: "vesi",
    WATER_METER_DRIVER: "kamwater",
    WATER_METER_ID: "76822855",
    WATER_METER_KEY: "replace_with_water_meter_dek",
    MQTT_IN_USE: "true",
    MQTT_BROKER_URL: "mqtt://broker-url",
    MQTT_PORT: "1883",
    MQTT_CLIENT_ID: "wmbus-reader",
    MQTT_HEAT_TOPIC: "wmbus/kaukolampo/state",
    MQTT_WATER_TOPIC: "wmbus/vesi/state",
    MQTT_RAW_TOPIC: "wmbus/raw",
    MQTT_STATUS_TOPIC: "wmbus/status",
    MQTT_EVENT_TOPIC: "wmbus/event",
    MQTT_PUBLISH_RAW: "false",
    MQTT_RETAIN: "false",
    MQTT_QOS: "0",
    HA_DISCOVERY_ENABLED: "false",
    HA_DISCOVERY_PREFIX: "homeassistant",
    HA_DISCOVERY_RETAIN: "true",
    HA_DEVICE_MANUFACTURER: "Kamstrup",
  };
}
