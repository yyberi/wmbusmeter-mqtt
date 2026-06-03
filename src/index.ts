import "dotenv/config";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createPublisher } from "./mqttClient.js";
import { Simulator } from "./simulator.js";
import { WmbusProcess } from "./wmbusProcess.js";

const config = loadConfig();
const logger = createLogger(config);
const publisher = createPublisher(config, logger);

let simulator: Simulator | undefined;
let wmbusProcess: WmbusProcess | undefined;
let shutdownStarted = false;

publisher.publishStatus("online");

if (config.simulate) {
  simulator = new Simulator(config, logger, publisher);
  simulator.start();
} else {
  wmbusProcess = new WmbusProcess(config, logger, publisher, (payload) => {
    publisher.publishTelegram(payload);
  });
  wmbusProcess.start();
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (error) => {
  logger.error({ error }, "Unhandled rejection");
});

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;

  logger.info({ reason }, "Shutting down");
  simulator?.stop();
  await wmbusProcess?.stop();
  await publisher.close();
  process.exit(exitCode);
}
