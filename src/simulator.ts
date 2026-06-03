import type { AppConfig } from "./config.js";
import type { AppLogger } from "./logger.js";
import type { TelegramPublisher } from "./mqttClient.js";
import type { HeatTelegram, WaterTelegram } from "./types.js";

export class Simulator {
  private timer?: NodeJS.Timeout;
  private energyKwh = 32393;
  private heatVolumeM3 = 749.74;
  private waterTotalM3 = 312.837;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly publisher: TelegramPublisher,
  ) {}

  start(): void {
    this.logger.info({ intervalMs: this.config.simulationIntervalMs }, "Starting wmbus simulator");
    this.publishOnce();
    this.timer = setInterval(() => this.publishOnce(), this.config.simulationIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.info("Stopped wmbus simulator");
  }

  private publishOnce(): void {
    this.energyKwh += 0.02;
    this.heatVolumeM3 += 0.001;
    this.waterTotalM3 += 0.002;

    const timestamp = new Date().toISOString();
    const meterDate = timestamp.slice(0, 10);

    const heat: HeatTelegram = {
      _: "telegram",
      media: "heat",
      meter: "kamheat",
      name: this.config.heatMeter.name,
      id: this.config.heatMeter.id,
      forward_energy_m3c: 53268,
      return_energy_m3c: 25233,
      t1_temperature_c: 67.4,
      t2_temperature_c: 44.4,
      target_date: "2026-06-01",
      target_energy_kwh: 32331,
      target_volume_m3: 747.58,
      total_energy_consumption_kwh: Number(this.energyKwh.toFixed(3)),
      total_volume_m3: Number(this.heatVolumeM3.toFixed(3)),
      volume_flow_m3h: 0.018,
      meter_date: meterDate,
      status: "OK",
      timestamp,
      device: "iu891a[00202001]",
      rssi_dbm: -39,
    };

    const water: WaterTelegram = {
      _: "telegram",
      media: "cold water",
      meter: "kamwater",
      name: this.config.waterMeter.name,
      id: this.config.waterMeter.id,
      flow_temperature_c: 7,
      min_flow_temperature_c: 7,
      target_m3: 311.913,
      total_m3: Number(this.waterTotalM3.toFixed(3)),
      current_status: "",
      status: "OK",
      time_bursting: "",
      time_dry: "",
      time_leaking: "",
      time_reversed: "",
      timestamp,
      device: "iu891a[00202001]",
      rssi_dbm: -45,
    };

    this.publisher.publishTelegram(heat);
    this.publisher.publishTelegram(water);
  }
}
