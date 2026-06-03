FROM node:22-bookworm-slim AS node-build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS wmbusmeters-build

ARG WMBUSMETERS_REF=master

RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  build-essential \
  cmake \
  pkg-config \
  libxml2-dev \
  libssl-dev \
  librtlsdr-dev \
  libmosquitto-dev \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/wmbusmeters/wmbusmeters.git /src/wmbusmeters
WORKDIR /src/wmbusmeters
RUN git checkout "$WMBUSMETERS_REF" \
  && ./configure \
  && make -j$(nproc) \
  && make install \
  && install -Dm755 "$(command -v wmbusmeters)" /artifacts/wmbusmeters

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  libxml2 \
  libssl3 \
  librtlsdr0 \
  libmosquitto1 \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=wmbusmeters-build /artifacts/wmbusmeters /usr/local/bin/wmbusmeters
COPY --from=node-build /app/dist ./dist
COPY --from=node-build /app/node_modules ./node_modules
COPY --from=node-build /app/package*.json ./

CMD ["node", "dist/index.js"]
