import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { AppConfig, MqttConfig } from "./config.js";
import { buildHomeAssistantDiscoveryMessages } from "./homeAssistantDiscovery.js";
import type { AppLogger } from "./logger.js";
import type { WmbusTelegram } from "./types.js";

export interface TelegramPublisher {
  publishTelegram(payload: WmbusTelegram): void;
  publishStatus(status: string, extra?: Record<string, unknown>): void;
  publishEvent(event: string, extra?: Record<string, unknown>): void;
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
        retain: this.shouldRetainStatus(),
      },
    };

    this.client = mqtt.connect(mqttConfig.brokerUrl, options);
    this.client.on("connect", () => {
      this.logger.info({ brokerUrl: mqttConfig.brokerUrl, clientId: mqttConfig.clientId }, "MQTT connected");
      this.publishStatus("online");
      this.publishHomeAssistantDiscovery();
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
      {
        qos: this.config.mqtt.qos,
        retain: this.shouldRetainStatus(),
      },
    );
  }

  publishEvent(event: string, extra: Record<string, unknown> = {}): void {
    this.publish(
      this.config.mqtt.eventTopic,
      JSON.stringify({
        event,
        service: "wmbus-reader",
        timestamp: new Date().toISOString(),
        ...extra,
      }),
      {
        qos: this.config.mqtt.qos,
        retain: false,
      },
    );
  }

  async close(): Promise<void> {
    this.publishStatus("offline");
    await new Promise<void>((resolve) => {
      this.client.end(false, {}, () => resolve());
    });
  }

  private publish(topic: string, payload: string, mqttConfig: Pick<MqttConfig, "qos" | "retain">): void {
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

  private shouldRetainStatus(): boolean {
    return this.config.homeAssistant.discoveryEnabled || this.config.mqtt.retain;
  }

  private publishHomeAssistantDiscovery(): void {
    if (!this.config.homeAssistant.discoveryEnabled) {
      return;
    }

    const messages = buildHomeAssistantDiscoveryMessages(this.config);
    for (const message of messages) {
      if (message.legacyTopic && message.legacyTopic !== message.topic) {
        this.client.publish(
          message.legacyTopic,
          "",
          {
            qos: this.config.mqtt.qos,
            retain: true,
          },
          (error) => {
            if (error) {
              this.logger.error({ error, topic: message.legacyTopic }, "Legacy Home Assistant MQTT discovery cleanup failed");
              return;
            }
            this.logger.debug({ topic: message.legacyTopic }, "Legacy Home Assistant MQTT discovery config cleared");
          },
        );
      }

      this.client.publish(
        message.topic,
        JSON.stringify(message.payload),
        {
          qos: this.config.mqtt.qos,
          retain: this.config.homeAssistant.discoveryRetain,
        },
        (error) => {
          if (error) {
            this.logger.error({ error, topic: message.topic }, "Home Assistant MQTT discovery publish failed");
            return;
          }
          this.logger.info({ topic: message.topic }, "Home Assistant MQTT discovery published");
        },
      );
    }
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

  publishEvent(event: string, extra: Record<string, unknown> = {}): void {
    this.logger.info({ event, ...extra }, "MQTT disabled, event not published");
  }

  async close(): Promise<void> {
    this.logger.info("MQTT disabled, no connection to close");
  }
}
