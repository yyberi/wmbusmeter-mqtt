#!/usr/bin/env node
import { createDecipheriv } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

type EncKeyName =
  | "PK1"
  | "PK2"
  | "PK3"
  | "DEK"
  | "GPK1"
  | "GPK2"
  | "GPK3"
  | "GPK4";

type EncKeys = Partial<Record<EncKeyName, string>>;

interface MeterInfo {
  meterNo?: string;
  serialNo?: string;
  meterName?: string;
  consumptionType?: string;
  configNo?: string;
  programNo?: string;
  typeNo?: string;
  vendorId?: string;
  encKeys: EncKeys;
}

interface DecryptResult {
  file: string;
  algorithm: "aes-128-cbc";
  keyDerivation: string;
  meters: MeterInfo[];
}

interface CliOptions {
  kemPath?: string;
  password?: string;
  json: boolean;
  redact: boolean;
  printXml: boolean;
  writeXml?: string;
}

const ENC_KEY_NAMES: EncKeyName[] = [
  "PK1",
  "PK2",
  "PK3",
  "DEK",
  "GPK1",
  "GPK2",
  "GPK3",
  "GPK4",
];

function usage(exitCode = 1): never {
  const text = `
Usage:
  npx tsx decrypt-kamstrup-kem.ts <file.kem> <password> [options]

Alternative:
  KEM_PASSWORD=<password> npx tsx decrypt-kamstrup-kem.ts <file.kem> [options]

Options:
  --json                 Print machine-readable JSON
  --redact               Redact encryption keys in output
  --print-xml            Print decrypted XML to stdout
  --write-xml <path>     Write decrypted XML to a file
  -h, --help             Show this help

Kamstrup KEM decryption used here:
  - password encoded as UTF-8
  - password zero-padded to 16 bytes
  - AES-128-CBC key = padded password
  - AES-128-CBC IV  = padded password
  - PKCS#7 padding
`;

  console.error(text.trim());
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    redact: false,
    printXml: false,
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      usage(0);
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--redact") {
      options.redact = true;
      continue;
    }

    if (arg === "--print-xml") {
      options.printXml = true;
      continue;
    }

    if (arg === "--write-xml") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --write-xml");
      }
      options.writeXml = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  options.kemPath = positional[0];
  options.password = positional[1] ?? process.env.KEM_PASSWORD;

  return options;
}

function extractCipherValue(encryptedXml: string): string {
  const xml = encryptedXml.replace(/^\uFEFF/, "");
  const match = xml.match(
    /<(?:[A-Za-z0-9_-]+:)?CipherValue\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?CipherValue>/i,
  );

  if (!match?.[1]) {
    throw new Error("CipherValue element was not found from the KEM file");
  }

  return match[1].replace(/\s+/g, "");
}

function deriveKamstrupKemKey(password: string): Buffer {
  const passwordBytes = Buffer.from(password, "utf8");

  if (passwordBytes.length === 0) {
    throw new Error("Password must not be empty");
  }

  if (passwordBytes.length > 16) {
    throw new Error(
      `Password is ${passwordBytes.length} bytes, but this KEM method supports at most 16 bytes`,
    );
  }

  const key = Buffer.alloc(16, 0x00);
  passwordBytes.copy(key);
  return key;
}

function decryptKemXml(kemXml: string, password: string): string {
  const cipherValue = extractCipherValue(kemXml);
  const encryptedBytes = Buffer.from(cipherValue, "base64");

  if (encryptedBytes.length === 0 || encryptedBytes.length % 16 !== 0) {
    throw new Error(
      `Ciphertext length ${encryptedBytes.length} is not a positive multiple of AES block size 16`,
    );
  }

  const key = deriveKamstrupKemKey(password);
  const iv = Buffer.from(key);

  try {
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    const decrypted = Buffer.concat([
      decipher.update(encryptedBytes),
      decipher.final(),
    ]);

    const decryptedXml = decrypted.toString("utf8").replace(/^\uFEFF/, "").trim();

    if (!decryptedXml.startsWith("<")) {
      throw new Error(
        "Decryption completed, but plaintext does not look like XML. The password is probably wrong.",
      );
    }

    return decryptedXml;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `KEM decryption failed. The password is probably wrong, or the file uses another KEM format. Details: ${message}`,
    );
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractTag(xml: string, tagName: string): string | undefined {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escapedTag}>`,
    "i",
  );
  const match = xml.match(re);
  const raw = match?.[1]?.trim();
  return raw ? decodeXmlEntities(raw) : undefined;
}

function extractMeterBlocks(decryptedXml: string): string[] {
  const meterBlocks: string[] = [];
  const re = /<(?:[A-Za-z0-9_-]+:)?Meter\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?Meter>/gi;

  let match: RegExpExecArray | null;
  while ((match = re.exec(decryptedXml)) !== null) {
    if (match[1]) {
      meterBlocks.push(match[1]);
    }
  }

  return meterBlocks;
}

function parseMeters(decryptedXml: string): MeterInfo[] {
  const blocks = extractMeterBlocks(decryptedXml);

  if (blocks.length === 0) {
    throw new Error("No <Meter> elements were found from decrypted XML");
  }

  return blocks.map((block) => {
    const encKeys: EncKeys = {};
    const encKeysBlock = extractTag(block, "EncKeys") ?? block;

    for (const keyName of ENC_KEY_NAMES) {
      const value = extractTag(encKeysBlock, keyName);
      if (value) {
        encKeys[keyName] = value;
      }
    }

    return {
      meterNo: extractTag(block, "MeterNo"),
      serialNo: extractTag(block, "SerialNo"),
      meterName: extractTag(block, "MeterName"),
      consumptionType: extractTag(block, "ConsumptionType"),
      configNo: extractTag(block, "ConfigNo"),
      programNo: extractTag(block, "ProgramNo"),
      typeNo: extractTag(block, "TypeNo"),
      vendorId: extractTag(block, "VendorId"),
      encKeys,
    };
  });
}

function redactValue(value: string): string {
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactResult(result: DecryptResult): DecryptResult {
  return {
    ...result,
    meters: result.meters.map((meter) => {
      const redactedKeys: EncKeys = {};
      for (const [key, value] of Object.entries(meter.encKeys)) {
        redactedKeys[key as EncKeyName] = value ? redactValue(value) : value;
      }
      return { ...meter, encKeys: redactedKeys };
    }),
  };
}

function printHuman(result: DecryptResult): void {
  console.log(`KEM decrypted OK: ${result.file}`);
  console.log(`Algorithm: ${result.algorithm}`);
  console.log(`Key derivation: ${result.keyDerivation}`);
  console.log("");

  result.meters.forEach((meter, index) => {
    console.log(`Meter ${index + 1}:`);
    console.log(`  MeterNo:         ${meter.meterNo ?? ""}`);
    console.log(`  SerialNo:        ${meter.serialNo ?? ""}`);
    console.log(`  MeterName:       ${meter.meterName ?? ""}`);
    console.log(`  ConsumptionType: ${meter.consumptionType ?? ""}`);
    console.log(`  VendorId:        ${meter.vendorId ?? ""}`);

    if (meter.configNo) console.log(`  ConfigNo:        ${meter.configNo}`);
    if (meter.programNo) console.log(`  ProgramNo:       ${meter.programNo}`);
    if (meter.typeNo) console.log(`  TypeNo:          ${meter.typeNo}`);

    console.log("  EncKeys:");
    for (const keyName of ENC_KEY_NAMES) {
      const value = meter.encKeys[keyName];
      if (value) {
        console.log(`    ${keyName}: ${value}`);
      }
    }
    console.log("");
  });
}

function main(): void {
  let options: CliOptions;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage(1);
  }

  if (!options.kemPath || !options.password) {
    usage(1);
  }

  const kemXml = readFileSync(options.kemPath, "utf8");
  const decryptedXml = decryptKemXml(kemXml, options.password);

  if (options.writeXml) {
    writeFileSync(options.writeXml, `${decryptedXml}\n`, "utf8");
  }

  if (options.printXml) {
    console.log(decryptedXml);
    return;
  }

  const result: DecryptResult = {
    file: basename(options.kemPath),
    algorithm: "aes-128-cbc",
    keyDerivation:
      "password UTF-8 bytes zero-padded to 16 bytes; IV equals the same 16 bytes; PKCS#7 padding",
    meters: parseMeters(decryptedXml),
  };

  const output = options.redact ? redactResult(result) : result;

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printHuman(output);
  }
}

main();
