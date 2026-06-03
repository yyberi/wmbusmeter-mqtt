import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { AppConfig } from "./config.js";
import type { AppLogger } from "./logger.js";
import type { TelegramPublisher } from "./mqttClient.js";
import type { WmbusTelegram } from "./types.js";
import { LineBuffer } from "./utils/lineBuffer.js";

export type TelegramHandler = (payload: WmbusTelegram) => void;

export class WmbusProcess {
  private child?: ChildProcessByStdio<null, Readable, Readable>;
  private restartTimer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private intentionalStop = false;
  private lastDataAt = Date.now();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly publisher: TelegramPublisher,
    private readonly onTelegram: TelegramHandler,
  ) {}

  start(): void {
    this.intentionalStop = false;
    this.startChild();
    this.startWatchdog();
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.clearRestartTimer();
    this.stopWatchdog();

    const child = this.child;
    if (!child || child.killed) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (!child.killed) {
          this.logger.warn("wmbusmeters did not stop after SIGTERM, sending SIGKILL");
          child.kill("SIGKILL");
        }
        resolve();
      }, 5000);

      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });

      child.kill("SIGTERM");
    });
  }

  private startChild(): void {
    const args = buildWmbusArgs(this.config);
    this.lastDataAt = Date.now();
    this.logger.info(
      { command: this.config.wmbusCommand, args: maskWmbusArgs(args) },
      "Starting wmbusmeters",
    );
    this.publisher.publishStatus("wmbusmeters_starting");

    const child = spawn(this.config.wmbusCommand, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    const stdoutBuffer = new LineBuffer();
    const stderrBuffer = new LineBuffer();

    child.stdout.on("data", (chunk) => {
      for (const line of stdoutBuffer.push(chunk)) {
        this.handleStdoutLine(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      for (const line of stderrBuffer.push(chunk)) {
        this.handleStderrLine(line);
      }
    });

    child.on("error", (error) => {
      this.logger.error({ error }, "wmbusmeters process error");
      this.publisher.publishStatus("wmbusmeters_error", { error: error.message });
    });

    child.on("close", (code, signal) => {
      const stdoutTail = stdoutBuffer.flush();
      const stderrTail = stderrBuffer.flush();
      if (stdoutTail) {
        this.handleStdoutLine(stdoutTail);
      }
      if (stderrTail) {
        this.handleStderrLine(stderrTail);
      }

      this.child = undefined;
      if (this.intentionalStop) {
        this.logger.info({ code, signal }, "wmbusmeters stopped");
        this.publisher.publishStatus("wmbusmeters_stopped", { code, signal });
        return;
      }

      this.logger.warn({ code, signal }, "wmbusmeters exited unexpectedly");
      this.publisher.publishStatus("wmbusmeters_crashed", { code, signal });
      this.scheduleRestart();
    });
  }

  private handleStdoutLine(line: string): void {
    const payload = parseWmbusLine(line, this.logger);
    if (!payload) {
      return;
    }
    this.lastDataAt = Date.now();
    this.onTelegram(payload);
  }

  private handleStderrLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed !== "") {
      this.logger.warn({ line: trimmed }, "wmbusmeters stderr");
    }
  }

  private scheduleRestart(): void {
    this.clearRestartTimer();
    this.publisher.publishStatus("wmbusmeters_restarting", { delayMs: this.config.restartDelayMs });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (!this.intentionalStop) {
        this.startChild();
      }
    }, this.config.restartDelayMs);
  }

  private startWatchdog(): void {
    if (this.config.watchdogTimeoutMs === 0) {
      this.logger.info("Watchdog disabled");
      return;
    }

    this.stopWatchdog();
    const intervalMs = Math.min(Math.max(Math.floor(this.config.watchdogTimeoutMs / 2), 60_000), this.config.watchdogTimeoutMs);
    this.watchdogTimer = setInterval(() => {
      const ageMs = Date.now() - this.lastDataAt;
      if (ageMs < this.config.watchdogTimeoutMs) {
        return;
      }

      this.logger.warn({ ageMs, timeoutMs: this.config.watchdogTimeoutMs }, "No wmbusmeters data received within watchdog timeout");
      this.publisher.publishStatus("wmbusmeters_watchdog_timeout", { ageMs });
      this.lastDataAt = Date.now();
      if (this.child && !this.child.killed) {
        this.child.kill("SIGTERM");
      }
    }, intervalMs);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }
}

export function buildWmbusArgs(config: AppConfig): string[] {
  return [
    config.wmbusDevice,
    config.heatMeter.name,
    config.heatMeter.driver,
    config.heatMeter.id,
    config.heatMeter.key,
    config.waterMeter.name,
    config.waterMeter.driver,
    config.waterMeter.id,
    config.waterMeter.key,
  ];
}

export function maskWmbusArgs(args: string[]): string[] {
  return args.map((arg, index) => (index === 4 || index === 8 ? "****" : arg));
}

export function parseWmbusLine(line: string, logger?: AppLogger): WmbusTelegram | undefined {
  const trimmed = line.trim();
  if (trimmed === "") {
    logger?.debug("Ignoring empty stdout line");
    return undefined;
  }

  if (!trimmed.startsWith("{")) {
    logger?.debug({ line: trimmed }, "Ignoring non-JSON stdout line");
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObject(parsed)) {
      logger?.warn({ line: trimmed }, "Ignoring JSON stdout value that is not an object");
      return undefined;
    }
    if (!("id" in parsed || "name" in parsed || "meter" in parsed)) {
      logger?.warn({ payload: parsed }, "Ignoring JSON payload without id, name or meter");
      return undefined;
    }
    return parsed as WmbusTelegram;
  } catch (error) {
    logger?.warn({ error, line: trimmed }, "Failed to parse wmbusmeters JSON line");
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
