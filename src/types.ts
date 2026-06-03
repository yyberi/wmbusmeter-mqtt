export interface WmbusTelegramBase {
  _: "telegram";
  media: string;
  meter: string;
  name: string;
  id: string;
  status?: string;
  timestamp?: string;
  device?: string;
  rssi_dbm?: number;
  [key: string]: unknown;
}

export interface HeatTelegram extends WmbusTelegramBase {
  media: "heat";
  meter: "kamheat";
  name: "kaukolampo" | string;
  id: "85231646" | string;
  forward_energy_m3c?: number;
  return_energy_m3c?: number;
  t1_temperature_c?: number;
  t2_temperature_c?: number;
  target_date?: string;
  target_energy_kwh?: number;
  target_volume_m3?: number;
  total_energy_consumption_kwh?: number;
  total_volume_m3?: number;
  volume_flow_m3h?: number;
  meter_date?: string;
}

export interface WaterTelegram extends WmbusTelegramBase {
  media: "cold water";
  meter: "kamwater";
  name: "vesi" | string;
  id: "76822855" | string;
  flow_temperature_c?: number;
  min_flow_temperature_c?: number;
  target_m3?: number;
  total_m3?: number;
  current_status?: string;
  time_bursting?: string;
  time_dry?: string;
  time_leaking?: string;
  time_reversed?: string;
}

export type WmbusTelegram = HeatTelegram | WaterTelegram | WmbusTelegramBase;
