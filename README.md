# wmbusmeter-mqtt

Node.js / TypeScript -adapteri, joka ajaa `wmbusmeters`-ohjelmaa Docker-kontissa, lukee sen tuottamat JSON-mittarilukemat stdoutista ja julkaisee ne MQTT-brokerille. `wmbusmeters` hoitaa wM-Bus-radion, ajurit, salauksen purun ja mittariarvojen tulkinnan. Tämä sovellus hoitaa prosessinhallinnan, JSON-rivien käsittelyn, MQTT-topic-reitityksen ja simulaatiotilan.

## Tuettu laitteisto

- Raspberry Pi, myös ARM64-ympäristö
- IMST iU891A-XL 868 MHz USB Wireless M-Bus -vastaanotin
- Kamstrup MC603 / `kamheat`
- Kamstrup vesimittari / `kamwater`

## Host-testi

Testaa ensin, että `wmbusmeters` toimii hostissa. Älä kirjoita oikeita avaimia komentoon selväkielisinä shell-historiaan.

```bash
wmbusmeters --format=json /dev/ttyACM0:iu891a:c1,t1 kaukolampo kamheat 85231646 "$HEAT_METER_KEY" vesi kamwater 76822855 "$WATER_METER_KEY"
```

## Konfigurointi

```bash
cp .env.example .env
nano .env
```

Tärkeimmät asetukset oikealla laitteella:

```env
SIMULATE=false
SERIAL_DEVICE=/dev/ttyACM0
CONTAINER_SERIAL_DEVICE=/dev/ttyACM0
WMBUS_DEVICE=/dev/ttyACM0:iu891a:c1,t1
HEAT_METER_KEY=<oikea_lampomittarin_dek>
WATER_METER_KEY=<oikea_vesimittarin_dek>
```

Kehitystilassa `SIMULATE=true` ei käynnistä `wmbusmeters`-prosessia eikä vaadi USB-laitetta.

## Kehitys

```bash
npm install
npm run dev
```

Simulaatiotila julkaisee määräajoin kaukolämpö- ja vesimittarin payloadit samaa MQTT-reititystä käyttäen kuin oikea ajotila.

## Docker

Build:

```bash
docker compose build
```

Käynnistys:

```bash
docker compose up -d
```

Lokit:

```bash
docker logs -f wmbus-reader
```

Pysäytys:

```bash
docker compose down
```

Kontti vastaanottaa `SIGTERM`-signaalin, pysäyttää lapsiprosessin ja julkaisee offline-statuksen MQTT:hen, jos yhteys on käytettävissä.

## Deploy Raspberry Pi:lle

Deploy käyttää `.env`-tiedoston asetuksia:

```env
DEPLOY_SERVER=user@target-server-ip
DEPLOY_TARGET_DIR=~/services/wmbusmeter-mqtt
DEPLOY_RUN_TESTS=true
```

Kohdekoneella pitää olla Docker ja Docker Compose käytettävissä samalla käyttäjällä, jolla SSH-yhteys avataan. Paikallisella koneella tarvitaan `ssh` ja `rsync`.
`DEPLOY_TARGET_DIR` voi alkaa muodolla `~/`, jolloin se tarkoittaa kohdekäyttäjän kotihakemistoa.

Deploy:

```bash
npm run deploy
```

Skripti tekee paikallisesti TypeScript-buildin ja oletuksena testit. Sen jälkeen se luo kohdehakemiston, synkronoi projektin `rsync`:llä ja ajaa kohdekoneella:

```bash
docker compose build
docker compose up -d
docker image prune -f
```

Deploy kopioi myös paikallisen `.env`-tiedoston kohdekoneelle, koska `docker-compose.yml` lukee salaiset mittari- ja MQTT-asetukset siitä. `.env` on gitin ulkopuolella eikä sitä pidä committaa. Synkronoinnista jätetään pois `.git`, `node_modules`, `dist`, `logs` ja lokitiedostot.

## MQTT

Topic-rakenne:

```text
wmbus/kaukolampo/state
wmbus/vesi/state
wmbus/raw
wmbus/status
```

MQTT-testit:

```bash
mosquitto_sub -h <broker-host> -t 'wmbus/#' -v
```

Kaukolämpö julkaistaan `MQTT_HEAT_TOPIC`-topiciin, jos payloadin `name`, `id` tai `meter` vastaa lämpömittarin asetuksia. Vesimittari julkaistaan vastaavasti `MQTT_WATER_TOPIC`-topiciin. Tuntemattomat validit JSON-payloadit julkaistaan `MQTT_RAW_TOPIC`-topiciin. Jos `MQTT_PUBLISH_RAW=true`, kaikki validit payloadit julkaistaan lisäksi raw-topiciin.

## USB-laite

Tarkista hostissa:

```bash
lsusb
ls -l /dev/ttyACM0
dmesg | tail -50
```

Docker Compose välittää laitteen konttiin:

```yaml
devices:
  - "${SERIAL_DEVICE:-/dev/ttyACM0}:${CONTAINER_SERIAL_DEVICE:-/dev/ttyACM0}:rw"
```

`SERIAL_DEVICE` on hostin laitepolku. `CONTAINER_SERIAL_DEVICE` ja `WMBUS_DEVICE` käyttävät kontin sisäistä laitepolkua.

## Pysyvä udev-symlink

Jos `/dev/ttyACM0` vaihtuu bootissa, käytä pysyvää symlinkkiä, esimerkiksi `/dev/wmbus-imst`. Selvitä laitteen tunnisteet:

```bash
udevadm info -a -n /dev/ttyACM0
```

Lisää sääntö esimerkiksi tiedostoon `/etc/udev/rules.d/99-wmbus-imst.rules` sovittamalla `idVendor`, `idProduct` ja tarvittaessa sarjanumero oman laitteen arvoihin:

```text
SUBSYSTEM=="tty", ATTRS{idVendor}=="xxxx", ATTRS{idProduct}=="yyyy", SYMLINK+="wmbus-imst", GROUP="dialout", MODE="0660"
```

Lataa säännöt:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
ls -l /dev/wmbus-imst
```

Tällöin `.env` voi olla:

```env
SERIAL_DEVICE=/dev/wmbus-imst
CONTAINER_SERIAL_DEVICE=/dev/wmbus-imst
WMBUS_DEVICE=/dev/wmbus-imst:iu891a:c1,t1
```

## Tietoturva

DEK/AES-avaimet ovat salaisia. Älä committaa `.env`-tiedostoa, älä rakenna avaimia Docker-imageen, älä kirjoita niitä README:hen tai composeen, äläkä logita niitä. Sovellus maskaa `wmbusmeters`-argumenteissa mittariavaimet muodossa `****`.

## Vianhaku

Kontti ei näe `/dev/ttyACM0`: tarkista `SERIAL_DEVICE`, `CONTAINER_SERIAL_DEVICE`, `docker compose config`, hostin laiteoikeudet ja että laite ei ole toisen prosessin varaama.

MQTT-yhteys ei muodostu: tarkista `MQTT_BROKER_URL`, `MQTT_PORT`, tunnukset, palomuuri ja että broker hyväksyy client id:n `MQTT_CLIENT_ID`.

`wmbusmeters` ei käynnisty: tarkista Docker buildin onnistuminen, imageen asennettu `/usr/local/bin/wmbusmeters`, `WMBUS_DEVICE` sekä USB-laitepolku kontin sisällä.

Mittarilta ei tule JSONia: tarkista vastaanottimen sijainti, signaalitaso, mittarin lähetysväli ja `wmbusmeters`-komennon toimivuus hostissa.
Sovellus käynnistää `wmbusmeters`in `--format=json`-optiolla; ilman sitä stdout ei välttämättä ole JSON-rivejä.

Väärä mittari-ID: varmista `HEAT_METER_ID` ja `WATER_METER_ID` host-testillä saatuja arvoja vasten.

Väärä avain: salattu mittari voi näkyä ilman tulkittuja arvoja tai virheellisenä purkuna. Tarkista DEK/AES-avain mittarikohtaisesti.

Signaalitaso heikko: seuraa `rssi_dbm`-arvoa, siirrä USB-vastaanotinta jatkokaapelilla ja vältä Raspberry Pi:n tai metallikotelon välitöntä läheisyyttä.

## Esimerkkipayloadit

Kaukolämpö:

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

Vesi:

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
