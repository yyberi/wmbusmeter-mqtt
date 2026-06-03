import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(process.cwd(), ".env") });

interface DeployConfig {
  server: string;
  targetDir: string;
  runTests: boolean;
}

const config = readDeployConfig();

await main(config);

async function main(deployConfig: DeployConfig): Promise<void> {
  if (!existsSync(".env")) {
    throw new Error("Missing .env. Create it from .env.example before deploying.");
  }

  validateRemoteTargetDir(deployConfig.targetDir);
  const remoteShellTargetDir = toRemoteShellPath(deployConfig.targetDir);
  const remoteRsyncTargetDir = toRemoteRsyncPath(deployConfig.targetDir);

  await run("npm", ["run", "build"]);

  if (deployConfig.runTests) {
    await run("npm", ["test", "--", "--run"]);
  }

  await run("ssh", [deployConfig.server, `mkdir -p ${remoteShellTargetDir}`]);

  await run("rsync", [
    "-az",
    "--delete",
    "--exclude",
    ".git",
    "--exclude",
    "node_modules",
    "--exclude",
    "dist",
    "--exclude",
    "logs",
    "--exclude",
    "*.log",
    "./",
    `${deployConfig.server}:${remoteRsyncTargetDir}`,
  ]);

  await run("ssh", [
    deployConfig.server,
    [
      `cd ${remoteShellTargetDir}`,
      "docker compose build",
      "docker compose up -d",
      "docker image prune -f",
    ].join(" && "),
  ]);
}

function readDeployConfig(): DeployConfig {
  return {
    server: required("DEPLOY_SERVER"),
    targetDir: required("DEPLOY_TARGET_DIR"),
    runTests: readBoolean("DEPLOY_RUN_TESTS", true),
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

async function run(command: string, args: string[]): Promise<void> {
  console.log(`\n$ ${command} ${args.map(maskArgForLog).join(" ")}`);

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}`));
    });
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function validateRemoteTargetDir(value: string): void {
  if (/\s/.test(value)) {
    throw new Error("DEPLOY_TARGET_DIR must not contain whitespace. Use a simple path such as ~/services/wmbusmeter-mqtt.");
  }
}

function toRemoteShellPath(value: string): string {
  if (value === "~") {
    return "$HOME";
  }
  if (value.startsWith("~/")) {
    return `$HOME/${shellQuote(value.slice(2))}`;
  }
  return shellQuote(value);
}

function toRemoteRsyncPath(value: string): string {
  return ensureTrailingSlash(value);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function maskArgForLog(value: string): string {
  return value.includes("MQTT_PASSWORD") || value.includes("METER_KEY") ? "****" : value;
}
