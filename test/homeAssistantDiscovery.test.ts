import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildHomeAssistantDiscoveryMessages } from "../src/homeAssistantDiscovery.js";
import { baseEnv } from "./config.test.js";

describe("buildHomeAssistantDiscoveryMessages", () => {
  const config = loadConfig({
    ...baseEnv(),
    HA_DISCOVERY_ENABLED: "true",
  });

  it("builds retained MQTT discovery configs for heat sensors", () => {
    const messages = buildHomeAssistantDiscoveryMessages(config);
    const energy = messages.find((message) => message.payload.unique_id === "wmbus_85231646_total_energy_consumption_kwh");

    expect(energy).toEqual({
      topic: "homeassistant/sensor/wmbus_85231646_kaukolampo/total_energy_consumption_kwh/config",
      legacyTopic: "homeassistant/sensor/wmbus_85231646_total_energy_consumption_kwh/config",
      payload: expect.objectContaining({
        name: "kaukolampo Total Energy",
        state_topic: "wmbus/kaukolampo/state",
        value_template: "{{ value_json.total_energy_consumption_kwh }}",
        availability_topic: "wmbus/status",
        availability_template: "{{ value_json.status }}",
        payload_available: "online",
        payload_not_available: "offline",
        json_attributes_topic: "wmbus/kaukolampo/state",
        device_class: "energy",
        state_class: "total_increasing",
        unit_of_measurement: "kWh",
        device: {
          identifiers: ["wmbus_85231646"],
          name: "kaukolampo",
          manufacturer: "Kamstrup",
          model: "kamheat",
          serial_number: "85231646",
        },
      }),
    });
  });

  it("builds water total sensor suitable for Home Assistant water statistics", () => {
    const messages = buildHomeAssistantDiscoveryMessages(config);
    const water = messages.find((message) => message.payload.unique_id === "wmbus_76822855_total_m3");

    expect(water?.topic).toBe("homeassistant/sensor/wmbus_76822855_vesi/total_m3/config");
    expect(water?.legacyTopic).toBe("homeassistant/sensor/wmbus_76822855_total_m3/config");
    expect(water?.payload).toEqual(expect.objectContaining({
      name: "vesi Total Water",
      state_topic: "wmbus/vesi/state",
      value_template: "{{ value_json.total_m3 }}",
      device_class: "water",
      state_class: "total_increasing",
      unit_of_measurement: "m³",
    }));
  });

  it("adds diagnostic RSSI sensors for both meters", () => {
    const messages = buildHomeAssistantDiscoveryMessages(config);
    const rssiSensors = messages.filter((message) => message.payload.unique_id.endsWith("_rssi_dbm"));

    expect(rssiSensors).toHaveLength(2);
    expect(rssiSensors.map((message) => message.payload)).toEqual([
      expect.objectContaining({
        entity_category: "diagnostic",
        device_class: "signal_strength",
        unit_of_measurement: "dBm",
      }),
      expect.objectContaining({
        entity_category: "diagnostic",
        device_class: "signal_strength",
        unit_of_measurement: "dBm",
      }),
    ]);
  });
});
