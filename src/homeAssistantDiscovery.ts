import type { AppConfig } from "./config.js";

export interface HomeAssistantDiscoveryMessage {
  topic: string;
  legacyTopic?: string;
  payload: HomeAssistantSensorConfig;
}

export interface HomeAssistantSensorConfig {
  name: string;
  unique_id: string;
  state_topic: string;
  value_template: string;
  availability_topic: string;
  availability_template: string;
  payload_available: string;
  payload_not_available: string;
  json_attributes_topic: string;
  device: HomeAssistantDevice;
  device_class?: string;
  state_class?: string;
  unit_of_measurement?: string;
  entity_category?: "diagnostic";
  suggested_display_precision?: number;
}

interface HomeAssistantDevice {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
  serial_number: string;
}

interface SensorDefinition {
  key: string;
  label: string;
  stateTopic: string;
  device: HomeAssistantDevice;
  deviceClass?: string;
  stateClass?: string;
  unit?: string;
  entityCategory?: "diagnostic";
  precision?: number;
}

export function buildHomeAssistantDiscoveryMessages(config: AppConfig): HomeAssistantDiscoveryMessage[] {
  const sensors: SensorDefinition[] = [
    ...buildHeatSensors(config),
    ...buildWaterSensors(config),
  ];

  return sensors.map((sensor) => {
    const uniqueId = sanitizeId(`wmbus_${sensor.device.serial_number}_${sensor.key}`);
    const nodeId = sanitizeId(`wmbus_${sensor.device.serial_number}_${sensor.device.name}`);
    const objectId = sanitizeId(sensor.key);
    const discoveryPrefix = trimSlashes(config.homeAssistant.discoveryPrefix);
    return {
      topic: `${discoveryPrefix}/sensor/${nodeId}/${objectId}/config`,
      legacyTopic: `${discoveryPrefix}/sensor/${uniqueId}/config`,
      payload: {
        name: `${sensor.device.name} ${sensor.label}`,
        unique_id: uniqueId,
        state_topic: sensor.stateTopic,
        value_template: `{{ value_json.${sensor.key} }}`,
        availability_topic: config.mqtt.statusTopic,
        availability_template: "{{ value_json.status }}",
        payload_available: "online",
        payload_not_available: "offline",
        json_attributes_topic: sensor.stateTopic,
        device: sensor.device,
        ...(sensor.deviceClass ? { device_class: sensor.deviceClass } : {}),
        ...(sensor.stateClass ? { state_class: sensor.stateClass } : {}),
        ...(sensor.unit ? { unit_of_measurement: sensor.unit } : {}),
        ...(sensor.entityCategory ? { entity_category: sensor.entityCategory } : {}),
        ...(sensor.precision !== undefined ? { suggested_display_precision: sensor.precision } : {}),
      },
    };
  });
}

function buildHeatSensors(config: AppConfig): SensorDefinition[] {
  const device = buildDevice(config, "heat");
  return [
    {
      key: "total_energy_consumption_kwh",
      label: "Total Energy",
      stateTopic: config.mqtt.heatTopic,
      device,
      deviceClass: "energy",
      stateClass: "total_increasing",
      unit: "kWh",
      precision: 1,
    },
    {
      key: "total_volume_m3",
      label: "Total Volume",
      stateTopic: config.mqtt.heatTopic,
      device,
      deviceClass: "volume",
      stateClass: "total_increasing",
      unit: "m³",
      precision: 3,
    },
    {
      key: "volume_flow_m3h",
      label: "Volume Flow",
      stateTopic: config.mqtt.heatTopic,
      device,
      deviceClass: "volume_flow_rate",
      stateClass: "measurement",
      unit: "m³/h",
      precision: 3,
    },
    {
      key: "t1_temperature_c",
      label: "Flow Temperature",
      stateTopic: config.mqtt.heatTopic,
      device,
      deviceClass: "temperature",
      stateClass: "measurement",
      unit: "°C",
      precision: 1,
    },
    {
      key: "t2_temperature_c",
      label: "Return Temperature",
      stateTopic: config.mqtt.heatTopic,
      device,
      deviceClass: "temperature",
      stateClass: "measurement",
      unit: "°C",
      precision: 1,
    },
    {
      key: "rssi_dbm",
      label: "RSSI",
      stateTopic: config.mqtt.heatTopic,
      device,
      deviceClass: "signal_strength",
      stateClass: "measurement",
      unit: "dBm",
      entityCategory: "diagnostic",
    },
  ];
}

function buildWaterSensors(config: AppConfig): SensorDefinition[] {
  const device = buildDevice(config, "water");
  return [
    {
      key: "total_m3",
      label: "Total Water",
      stateTopic: config.mqtt.waterTopic,
      device,
      deviceClass: "water",
      stateClass: "total_increasing",
      unit: "m³",
      precision: 3,
    },
    {
      key: "flow_temperature_c",
      label: "Temperature",
      stateTopic: config.mqtt.waterTopic,
      device,
      deviceClass: "temperature",
      stateClass: "measurement",
      unit: "°C",
      precision: 1,
    },
    {
      key: "min_flow_temperature_c",
      label: "Minimum Temperature",
      stateTopic: config.mqtt.waterTopic,
      device,
      deviceClass: "temperature",
      stateClass: "measurement",
      unit: "°C",
      precision: 1,
    },
    {
      key: "rssi_dbm",
      label: "RSSI",
      stateTopic: config.mqtt.waterTopic,
      device,
      deviceClass: "signal_strength",
      stateClass: "measurement",
      unit: "dBm",
      entityCategory: "diagnostic",
    },
  ];
}

function buildDevice(config: AppConfig, type: "heat" | "water"): HomeAssistantDevice {
  const meter = type === "heat" ? config.heatMeter : config.waterMeter;
  return {
    identifiers: [`wmbus_${meter.id}`],
    name: meter.name,
    manufacturer: config.homeAssistant.deviceManufacturer,
    model: meter.driver,
    serial_number: meter.id,
  };
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}
