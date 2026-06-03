import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import type { AppConfig } from "./config.js";

export function createLogger(config: Pick<AppConfig, "logLevel" | "logDir">) {
  const options = {
    level: config.logLevel,
    base: {
      service: "wmbus-reader",
    },
  };

  try {
    mkdirSync(config.logDir, { recursive: true });
    return pino(
      options,
      pino.multistream([
        { stream: process.stdout },
        { stream: pino.destination({ dest: join(config.logDir, "wmbus-reader.log"), sync: false }) },
      ]),
    );
  } catch {
    return pino(options);
  }
}

export type AppLogger = ReturnType<typeof createLogger>;
