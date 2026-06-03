import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { AppConfig, MqttConfig } from "./config.js";
import type { AppLogger } from "./logger.js";
import type { WmbusTelegram } from "./types.js";

export interface TelegramPublisher {
  publishTelegram(payload: WmbusTelegram): void;
  publishStatus(status: string, extra?: Record<string, unknown>): void;
  close(): Promise<void>;
}

export function resolveTelegramTopic(payload: Partial<WmbusTelegram>, config: AppConfig): string {
  if (
    payload.name === config.heatMeter.name ||
    payload.id === config.heatMeter.id ||
    payload.meter === config.heatMeter.driver
  ) {
    return config.mqtt.heatTopic;
  }

  if (
    payload.name === config.waterMeter.name ||
    payload.id === config.waterMeter.id ||
    payload.meter === config.waterMeter.driver
  ) {
    return config.mqtt.waterTopic;
  }

  return config.mqtt.rawTopic;
}

export function createPublisher(config: AppConfig, logger: AppLogger): TelegramPublisher {
  if (!config.mqtt.inUse) {
    return new NoopPublisher(logger);
  }

  return new MqttPublisher(config, logger);
}

class MqttPublisher implements TelegramPublisher {
  private readonly client: MqttClient;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {
    const mqttConfig = config.mqtt;
    const options: IClientOptions = {
      port: mqttConfig.port,
      clientId: mqttConfig.clientId,
      username: mqttConfig.username,
      password: mqttConfig.password,
      reconnectPeriod: 5000,
      keepalive: 60,
      will: {
        topic: mqttConfig.statusTopic,
        payload: JSON.stringify({
          status: "offline",
          service: "wmbus-reader",
        }),
        qos: mqttConfig.qos,
        retain: mqttConfig.retain,
      },
    };

    this.client = mqtt.connect(mqttConfig.brokerUrl, options);
    this.client.on("connect", () => {
      this.logger.info({ brokerUrl: mqttConfig.brokerUrl, clientId: mqttConfig.clientId }, "MQTT connected");
      this.publishStatus("online");
    });
    this.client.on("reconnect", () => this.logger.info("MQTT reconnecting"));
    this.client.on("close", () => this.logger.info("MQTT connection closed"));
    this.client.on("offline", () => this.logger.warn("MQTT client offline"));
    this.client.on("error", (error) => this.logger.error({ error }, "MQTT error"));
  }

  publishTelegram(payload: WmbusTelegram): void {
    const primaryTopic = resolveTelegramTopic(payload, this.config);
    const body = JSON.stringify(payload);
    this.publish(primaryTopic, body, this.config.mqtt);

    if (this.config.mqtt.publishRaw && primaryTopic !== this.config.mqtt.rawTopic) {
      this.publish(this.config.mqtt.rawTopic, body, this.config.mqtt);
    }
  }

  publishStatus(status: string, extra: Record<string, unknown> = {}): void {
    this.publish(
      this.config.mqtt.statusTopic,
      JSON.stringify({
        status,
        service: "wmbus-reader",
        timestamp: new Date().toISOString(),
        ...extra,
      }),
      this.config.mqtt,
    );
  }

  async close(): Promise<void> {
    this.publishStatus("offline");
    await new Promise<void>((resolve) => {
      this.client.end(false, {}, () => resolve());
    });
  }

  private publish(topic: string, payload: string, mqttConfig: MqttConfig): void {
    this.client.publish(
      topic,
      payload,
      {
        qos: mqttConfig.qos,
        retain: mqttConfig.retain,
      },
      (error) => {
        if (error) {
          this.logger.error({ error, topic }, "MQTT publish failed");
          return;
        }
        this.logger.debug({ topic }, "MQTT published payload");
      },
    );
  }
}

class NoopPublisher implements TelegramPublisher {
  constructor(private readonly logger: AppLogger) {}

  publishTelegram(payload: WmbusTelegram): void {
    this.logger.info({ id: payload.id, name: payload.name, meter: payload.meter }, "MQTT disabled, dropping telegram");
  }

  publishStatus(status: string, extra: Record<string, unknown> = {}): void {
    this.logger.info({ status, ...extra }, "MQTT disabled, status not published");
  }

  async close(): Promise<void> {
    this.logger.info("MQTT disabled, no connection to close");
  }
}
