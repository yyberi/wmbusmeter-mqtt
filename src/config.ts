export interface MeterConfig {
  name: string;
  driver: string;
  id: string;
  key: string;
}

export interface MqttConfig {
  inUse: boolean;
  brokerUrl: string;
  port: number;
  username?: string;
  password?: string;
  clientId: string;
  baseTopic: string;
  heatTopic: string;
  waterTopic: string;
  rawTopic: string;
  statusTopic: string;
  eventTopic: string;
  publishRaw: boolean;
  retain: boolean;
  qos: MqttQos;
}

export type MqttQos = 0 | 1 | 2;

export interface HomeAssistantConfig {
  discoveryEnabled: boolean;
  discoveryPrefix: string;
  discoveryRetain: boolean;
  deviceManufacturer: string;
}

export interface AppConfig {
  nodeEnv: string;
  logDir: string;
  logLevel: string;
  simulate: boolean;
  simulationIntervalMs: number;
  watchdogTimeoutMs: number;
  restartDelayMs: number;
  wmbusCommand: string;
  wmbusDevice: string;
  wmbusLogTelegrams: boolean;
  heatMeter: MeterConfig;
  waterMeter: MeterConfig;
  mqtt: MqttConfig;
  homeAssistant: HomeAssistantConfig;
}

type Env = Record<string, string | undefined>;

const defaults = {
  NODE_ENV: "development",
  LOG_DIR: "./logs",
  LOG_LEVEL: "info",
  SIMULATION_INTERVAL_MS: "10000",
  WATCHDOG_TIMEOUT_MS: "900000",
  RESTART_DELAY_MS: "5000",
  WMBUS_LOG_TELEGRAMS: "false",
  MQTT_CLIENT_ID: "wmbus-reader",
  MQTT_BASE_TOPIC: "wmbus",
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

export function loadConfig(env: Env = process.env): AppConfig {
  const simulate = parseRequiredBoolean(env, "SIMULATE");
  const mqttInUse = parseRequiredBoolean(env, "MQTT_IN_USE");

  const heatMeter: MeterConfig = {
    name: required(env, "HEAT_METER_NAME"),
    driver: required(env, "HEAT_METER_DRIVER"),
    id: required(env, "HEAT_METER_ID"),
    key: value(env, "HEAT_METER_KEY", ""),
  };
  const waterMeter: MeterConfig = {
    name: required(env, "WATER_METER_NAME"),
    driver: required(env, "WATER_METER_DRIVER"),
    id: required(env, "WATER_METER_ID"),
    key: value(env, "WATER_METER_KEY", ""),
  };

  if (!simulate) {
    assertUsableKey(heatMeter.key, "HEAT_METER_KEY");
    assertUsableKey(waterMeter.key, "WATER_METER_KEY");
  }

  const mqttPort = parseRequiredNumber(env, "MQTT_PORT");
  const mqttQos = parseQos(value(env, "MQTT_QOS", defaults.MQTT_QOS));

  if (mqttInUse) {
    required(env, "MQTT_BROKER_URL");
  }

  return {
    nodeEnv: value(env, "NODE_ENV", defaults.NODE_ENV),
    logDir: value(env, "LOG_DIR", defaults.LOG_DIR),
    logLevel: value(env, "LOG_LEVEL", defaults.LOG_LEVEL),
    simulate,
    simulationIntervalMs: parseNumber(value(env, "SIMULATION_INTERVAL_MS", defaults.SIMULATION_INTERVAL_MS), "SIMULATION_INTERVAL_MS"),
    watchdogTimeoutMs: parseNumber(value(env, "WATCHDOG_TIMEOUT_MS", defaults.WATCHDOG_TIMEOUT_MS), "WATCHDOG_TIMEOUT_MS"),
    restartDelayMs: parseNumber(value(env, "RESTART_DELAY_MS", defaults.RESTART_DELAY_MS), "RESTART_DELAY_MS"),
    wmbusCommand: required(env, "WMBUS_COMMAND"),
    wmbusDevice: required(env, "WMBUS_DEVICE"),
    wmbusLogTelegrams: parseBoolean(value(env, "WMBUS_LOG_TELEGRAMS", defaults.WMBUS_LOG_TELEGRAMS), "WMBUS_LOG_TELEGRAMS"),
    heatMeter,
    waterMeter,
    mqtt: {
      inUse: mqttInUse,
      brokerUrl: value(env, "MQTT_BROKER_URL", ""),
      port: mqttPort,
      username: optional(env, "MQTT_USERNAME"),
      password: optional(env, "MQTT_PASSWORD"),
      clientId: value(env, "MQTT_CLIENT_ID", defaults.MQTT_CLIENT_ID),
      baseTopic: value(env, "MQTT_BASE_TOPIC", defaults.MQTT_BASE_TOPIC),
      heatTopic: value(env, "MQTT_HEAT_TOPIC", defaults.MQTT_HEAT_TOPIC),
      waterTopic: value(env, "MQTT_WATER_TOPIC", defaults.MQTT_WATER_TOPIC),
      rawTopic: value(env, "MQTT_RAW_TOPIC", defaults.MQTT_RAW_TOPIC),
      statusTopic: value(env, "MQTT_STATUS_TOPIC", defaults.MQTT_STATUS_TOPIC),
      eventTopic: value(env, "MQTT_EVENT_TOPIC", defaults.MQTT_EVENT_TOPIC),
      publishRaw: parseBoolean(value(env, "MQTT_PUBLISH_RAW", defaults.MQTT_PUBLISH_RAW), "MQTT_PUBLISH_RAW"),
      retain: parseBoolean(value(env, "MQTT_RETAIN", defaults.MQTT_RETAIN), "MQTT_RETAIN"),
      qos: mqttQos,
    },
    homeAssistant: {
      discoveryEnabled: parseBoolean(value(env, "HA_DISCOVERY_ENABLED", defaults.HA_DISCOVERY_ENABLED), "HA_DISCOVERY_ENABLED"),
      discoveryPrefix: value(env, "HA_DISCOVERY_PREFIX", defaults.HA_DISCOVERY_PREFIX),
      discoveryRetain: parseBoolean(value(env, "HA_DISCOVERY_RETAIN", defaults.HA_DISCOVERY_RETAIN), "HA_DISCOVERY_RETAIN"),
      deviceManufacturer: value(env, "HA_DEVICE_MANUFACTURER", defaults.HA_DEVICE_MANUFACTURER),
    },
  };
}

function required(env: Env, key: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`Missing required environment variable ${key}`);
  }
  return raw.trim();
}

function value(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  return raw.trim();
}

function optional(env: Env, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw === "") {
    return undefined;
  }
  return raw;
}

function parseRequiredBoolean(env: Env, key: string): boolean {
  return parseBoolean(required(env, key), key);
}

function parseBoolean(raw: string, key: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`${key} must be true or false`);
}

function parseRequiredNumber(env: Env, key: string): number {
  return parseNumber(required(env, key), key);
}

function parseNumber(raw: string, key: string): number {
  const numberValue = Number(raw);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${key} must be a number`);
  }
  return numberValue;
}

function parseQos(raw: string): MqttQos {
  const qos = parseNumber(raw, "MQTT_QOS");
  if (qos !== 0 && qos !== 1 && qos !== 2) {
    throw new Error("MQTT_QOS must be 0, 1 or 2");
  }
  return qos;
}

function assertUsableKey(key: string, envName: string): void {
  if (key.trim() === "" || key.toLowerCase().startsWith("replace_with")) {
    throw new Error(`${envName} must be set to a real meter key when SIMULATE=false`);
  }
}
