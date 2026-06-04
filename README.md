# wmbusmeter-mqtt

Node.js / TypeScript adapter that runs `wmbusmeters`, reads JSON meter telegrams from stdout, and publishes them to MQTT. `wmbusmeters` handles the Wireless M-Bus receiver, meter drivers, decryption, and value parsing. This service handles process supervision, JSON line parsing, MQTT topic routing, Home Assistant discovery, and simulation mode.

## Supported Hardware

- Raspberry Pi, including ARM64 environments
- IMST iU891A-XL 868 MHz USB Wireless M-Bus receiver
- Kamstrup MC603 / `kamheat`
- Kamstrup water meter / `kamwater`

## Prerequisites

- Node.js and npm for local development and helper scripts
- Docker and Docker Compose for containerized runtime
- `wmbusmeters` available in the runtime image or on the host when testing manually
- MQTT broker, unless `MQTT_IN_USE=false`
- USB access to the Wireless M-Bus receiver for real meter reads

## Host Test

Before running the service, verify that `wmbusmeters` can read the meters on the host. Avoid writing real keys directly into commands that are stored in shell history.

```bash
wmbusmeters --format=json /dev/ttyACM0:iu891a:c1,t1 kaukolampo kamheat 85231646 "$HEAT_METER_KEY" vesi kamwater 76822855 "$WATER_METER_KEY"
```

## Configuration

Create a local environment file:

```bash
cp .env.example .env
nano .env
```

Important settings for a real device:

```env
SIMULATE=false
SERIAL_DEVICE=/dev/ttyACM0
CONTAINER_SERIAL_DEVICE=/dev/ttyACM0
WMBUS_COMMAND=wmbusmeters
WMBUS_DEVICE=/dev/ttyACM0:iu891a:c1,t1

HEAT_METER_NAME=kaukolampo
HEAT_METER_DRIVER=kamheat
HEAT_METER_ID=85231646
HEAT_METER_KEY=<real_heat_meter_dek>

WATER_METER_NAME=vesi
WATER_METER_DRIVER=kamwater
WATER_METER_ID=76822855
WATER_METER_KEY=<real_water_meter_dek>

MQTT_IN_USE=true
MQTT_BROKER_URL=mqtt://broker-url
MQTT_PORT=1883
```

In development, `SIMULATE=true` skips the `wmbusmeters` process and does not require a USB receiver. The simulator publishes heat and water meter payloads through the same routing path as the real runtime.

Useful runtime settings:

- `SIMULATION_INTERVAL_MS`: interval for simulator payloads.
- `WATCHDOG_TIMEOUT_MS`: restarts `wmbusmeters` if no valid telegrams are received within the timeout. Set to `0` to disable.
- `RESTART_DELAY_MS`: delay before restarting a crashed `wmbusmeters` process.
- `WMBUS_LOG_TELEGRAMS`: adds `--logtelegrams` to the `wmbusmeters` command.
- `LOG_DIR` and `LOG_LEVEL`: local log output location and verbosity.

## Kamstrup KEM Decryption

Kamstrup `.kem` files can contain meter metadata and encryption keys such as `DEK`. This project includes a helper script for decrypting those files:

```bash
npm run kem:decrypt -- ./keys/heatmeter.kem 123456
```

The second argument is the KEM password. To avoid storing it in shell history, prefer using an environment variable:

```bash
KEM_PASSWORD=123456 npm run kem:decrypt -- ./keys/heatmeter.kem
```

Useful options:

```bash
npm run kem:decrypt -- ./keys/heatmeter.kem 123456 --redact
npm run kem:decrypt -- ./keys/heatmeter.kem 123456 --json
npm run kem:decrypt -- ./keys/heatmeter.kem 123456 --write-xml ./keys/heatmeter.xml
```

The script extracts meter fields such as meter number, serial number, consumption type, vendor ID, and encryption keys (`PK1`, `PK2`, `PK3`, `DEK`, `GPK1`, `GPK2`, `GPK3`, `GPK4`) when they are present. Use the meter-specific `DEK` value as `HEAT_METER_KEY` or `WATER_METER_KEY`. The `keys/` directory is ignored by git.

## Development

Install dependencies and start the TypeScript entrypoint:

```bash
npm install
npm run dev
```

Other local commands:

```bash
npm run build
npm test
npm run lint
```

`npm run lint` runs TypeScript checks for both application code and scripts.

## Docker

Build the image:

```bash
docker compose build
```

Start the service:

```bash
docker compose up -d
```

Follow logs:

```bash
docker logs -f wmbus-reader
```

Stop the service:

```bash
docker compose down
```

The container receives `SIGTERM`, stops the child process, and publishes an offline status to MQTT when the connection is available.

## Raspberry Pi Deployment

Deployment reads its settings from `.env`:

```env
DEPLOY_SERVER=user@target-server-ip
DEPLOY_TARGET_DIR=~/services/wmbusmeter-mqtt
DEPLOY_RUN_TESTS=true
```

The target host must have Docker and Docker Compose available to the SSH user. The local machine must have `ssh` and `rsync`. `DEPLOY_TARGET_DIR` may start with `~/`, which resolves to the target user's home directory.

Run deployment:

```bash
npm run deploy
```

The deploy script runs a local TypeScript build and, by default, tests. It then creates the target directory, syncs the project with `rsync`, and runs these commands on the target host:

```bash
docker compose build
docker compose up -d
docker image prune -f
```

Deployment also copies the local `.env` file because `docker-compose.yml` reads meter and MQTT secrets from it. `.env` is ignored by git and must not be committed. Sync excludes `.git`, `node_modules`, `dist`, `logs`, and log files.

## MQTT

Default topic layout:

```text
wmbus/kaukolampo/state
wmbus/vesi/state
wmbus/raw
wmbus/status
wmbus/event
```

MQTT smoke test:

```bash
mosquitto_sub -h <broker-host> -t 'wmbus/#' -v
```

Heat meter payloads are published to `MQTT_HEAT_TOPIC` when the payload `name`, `id`, or `meter` matches the heat meter settings. Water meter payloads are published to `MQTT_WATER_TOPIC` the same way. Unknown but valid JSON payloads are published to `MQTT_RAW_TOPIC`. If `MQTT_PUBLISH_RAW=true`, all valid payloads are also published to the raw topic.

`MQTT_STATUS_TOPIC` is the service availability topic and contains `online` or `offline` for Home Assistant. `wmbusmeters` process events, such as start, crash, restart, and watchdog timeout, are published to `MQTT_EVENT_TOPIC`.

Set `MQTT_IN_USE=false` to run without publishing to MQTT.

## Home Assistant MQTT Discovery

Home Assistant discovery is disabled by default. Enable it in `.env`:

```env
HA_DISCOVERY_ENABLED=true
HA_DISCOVERY_PREFIX=homeassistant
HA_DISCOVERY_RETAIN=true
HA_DEVICE_MANUFACTURER=Kamstrup
```

When the MQTT connection is established, the service publishes retained discovery configurations to Home Assistant MQTT discovery topics, for example:

```text
homeassistant/sensor/wmbus_85231646_kaukolampo/total_energy_consumption_kwh/config
homeassistant/sensor/wmbus_76822855_vesi/total_m3/config
```

Discovery topics use the Home Assistant `node_id` segment for meter-specific grouping:

```text
homeassistant/sensor/<node_id>/<object_id>/config
```

For example, the heat meter `node_id` is `wmbus_85231646_kaukolampo`, and the water meter `node_id` is `wmbus_76822855_vesi`.

Sensors read values from the same state topics where meter payloads are published:

```text
wmbus/kaukolampo/state
wmbus/vesi/state
```

Availability is read from `wmbus/status`. When the service publishes `online`, sensors are available. When it publishes `offline`, sensors become unavailable in Home Assistant. With discovery enabled, status is published as a retained message so sensors do not remain unavailable after a Home Assistant or MQTT integration restart.

Published Home Assistant sensors:

- Heat: total energy, total volume, volume flow, flow and return temperatures, RSSI.
- Water: total consumption, flow temperature, minimum flow temperature, RSSI.

The service clears its previous flat discovery topics by publishing empty retained messages to topics such as `homeassistant/sensor/wmbus_85231646_total_energy_consumption_kwh/config`.

## USB Device

Check the receiver on the host:

```bash
lsusb
ls -l /dev/ttyACM0
dmesg | tail -50
```

Docker Compose passes the device into the container:

```yaml
devices:
  - "${SERIAL_DEVICE:-/dev/ttyACM0}:${CONTAINER_SERIAL_DEVICE:-/dev/ttyACM0}:rw"
```

`SERIAL_DEVICE` is the host path. `CONTAINER_SERIAL_DEVICE` and `WMBUS_DEVICE` use the path inside the container.

## Persistent udev Symlink

If `/dev/ttyACM0` changes after reboot, create a persistent symlink such as `/dev/wmbus-imst`. Find device identifiers:

```bash
udevadm info -a -n /dev/ttyACM0
```

Add a rule such as `/etc/udev/rules.d/99-wmbus-imst.rules`, matching `idVendor`, `idProduct`, and optionally the serial number to your own receiver:

```text
SUBSYSTEM=="tty", ATTRS{idVendor}=="xxxx", ATTRS{idProduct}=="yyyy", SYMLINK+="wmbus-imst", GROUP="dialout", MODE="0660"
```

Reload rules:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
ls -l /dev/wmbus-imst
```

Then `.env` can use:

```env
SERIAL_DEVICE=/dev/wmbus-imst
CONTAINER_SERIAL_DEVICE=/dev/wmbus-imst
WMBUS_DEVICE=/dev/wmbus-imst:iu891a:c1,t1
```

## Security

DEK/AES meter keys, MQTT credentials, and KEM passwords are secrets. Do not commit `.env`, `keys/`, decrypted XML files, or real keys. Do not bake secrets into the Docker image, README, or compose file, and do not log them. The application masks meter keys in logged `wmbusmeters` arguments as `****`.

## Troubleshooting

Container cannot see `/dev/ttyACM0`: check `SERIAL_DEVICE`, `CONTAINER_SERIAL_DEVICE`, `docker compose config`, host device permissions, and whether another process is using the receiver.

MQTT connection fails: check `MQTT_IN_USE`, `MQTT_BROKER_URL`, `MQTT_PORT`, credentials, firewall rules, and whether the broker accepts `MQTT_CLIENT_ID`.

`wmbusmeters` does not start: check that the Docker build succeeded, `/usr/local/bin/wmbusmeters` exists in the image, `WMBUS_COMMAND` is correct, `WMBUS_DEVICE` is correct, and the USB path exists inside the container.

No JSON arrives from the meter: check receiver placement, signal level, meter transmission interval, and the manual `wmbusmeters` host command. The application starts `wmbusmeters` with `--format=json`; without it, stdout may not contain JSON lines.

Wrong meter ID: verify `HEAT_METER_ID` and `WATER_METER_ID` against the values found during host testing or from the decrypted KEM file.

Wrong key: encrypted meters may appear without parsed values or with failed decryption. Verify the meter-specific `DEK` or AES key.

Weak signal: monitor `rssi_dbm`, move the USB receiver with an extension cable, and avoid placing it directly next to a Raspberry Pi or metal enclosure.

## Example Payloads

Heat:

```json
{
  "_": "telegram",
  "media": "heat",
  "meter": "kamheat",
  "name": "kaukolampo",
  "id": "85231646",
  "forward_energy_m3c": 53268,
  "return_energy_m3c": 25233,
  "t1_temperature_c": 67.4,
  "t2_temperature_c": 44.4,
  "target_date": "2026-06-01",
  "target_energy_kwh": 32331,
  "target_volume_m3": 747.58,
  "total_energy_consumption_kwh": 32393,
  "total_volume_m3": 749.74,
  "volume_flow_m3h": 0.018,
  "meter_date": "2026-06-03",
  "status": "OK",
  "timestamp": "2026-06-03T17:21:59Z",
  "device": "iu891a[00202001]",
  "rssi_dbm": -39
}
```

Water:

```json
{
  "_": "telegram",
  "media": "cold water",
  "meter": "kamwater",
  "name": "vesi",
  "id": "76822855",
  "flow_temperature_c": 7,
  "min_flow_temperature_c": 7,
  "target_m3": 311.913,
  "total_m3": 312.837,
  "current_status": "",
  "status": "OK",
  "time_bursting": "",
  "time_dry": "",
  "time_leaking": "",
  "time_reversed": "",
  "timestamp": "2026-06-03T17:22:48Z",
  "device": "iu891a[00202001]",
  "rssi_dbm": -45
}
```
