# syntax=docker/dockerfile:1.7

FROM node:22-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY tsconfig.base.json ./
COPY shared/package.json shared/tsconfig.json shared/vitest.config.ts ./shared/
COPY backend/package.json backend/tsconfig.json ./backend/
COPY frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/components.json ./frontend/
COPY e2e/package.json ./e2e/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY shared ./shared
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=zh_CN.UTF-8 \
    LC_ALL=zh_CN.UTF-8 \
    NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/frontend/dist \
    CHROME_BIN=/opt/nya-chromium/chrome \
    PATH=/usr/local/bin:$PATH

COPY --from=node:22-bookworm /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm /usr/local/lib/node_modules /usr/local/lib/node_modules

ARG DEBIAN_MIRROR=
RUN set -eux; \
    if [ -n "${DEBIAN_MIRROR}" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g; s|security.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
      fi; \
      if [ -f /etc/apt/sources.list ]; then \
        sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g; s|security.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list; \
      fi; \
    fi; \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      wget \
      locales \
      fontconfig \
      fonts-liberation \
      fonts-liberation2 \
      fonts-dejavu-core \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fonts-noto-color-emoji \
      fonts-wqy-microhei \
      fonts-wqy-zenhei \
      fonts-ipafont \
      fonts-nanum \
      fonts-crosextra-carlito \
      fonts-crosextra-caladea \
      xvfb \
      x11vnc \
      openbox \
      tint2 \
      xclip \
      x11-xserver-utils \
      x11-utils \
      xcvt \
      wmctrl \
      xdotool \
      xdg-utils \
      dbus \
      dbus-x11 \
      libnss3 \
      libatk-bridge2.0-0 \
      libgtk-3-0 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      libgbm1 \
      libegl1 \
      libgles2 \
      libgl1 \
      libglvnd0 \
      libvulkan1 \
      libasound2 \
      libpangocairo-1.0-0 \
      libcups2 \
      libdrm2 \
      libxshmfence1 \
      libxkbcommon0 \
      libglib2.0-0 \
      libnspr4 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libdbus-1-3 \
      libexpat1 \
      libfontconfig1 \
      libfreetype6 \
      libxcb1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrender1 \
      libxtst6 \
      libatomic1 \
      procps \
      python3 \
      xz-utils \
      zstd \
      passwd \
      xauth \
      iptables \
    && sed -i 's/# zh_CN.UTF-8 UTF-8/zh_CN.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY config/fonts.conf /etc/fonts/conf.d/99-nya.conf
RUN fc-cache -f

WORKDIR /app

ARG NYA_GITHUB_REPO=metolab/nya-browser
ARG CHROMIUM_URL=
COPY browser/VERSION /tmp/CHROMIUM_VERSION
COPY browser/CHROMIUM.sha256 /tmp/CHROMIUM.sha256
COPY browser/TAMPERMONKEY.sha256 /tmp/TAMPERMONKEY.sha256
COPY cache/ /tmp/chromium-cache/
COPY scripts/install-chromium.sh /tmp/install-chromium.sh
COPY scripts/install-tampermonkey.sh /tmp/install-tampermonkey.sh
RUN --mount=type=secret,id=github_token,required=false \
    CHROMIUM_VERSION="$(tr -d ' \n' < /tmp/CHROMIUM_VERSION)" \
    NYA_GITHUB_REPO="${NYA_GITHUB_REPO}" \
    CHROMIUM_URL="${CHROMIUM_URL}" \
    CHROMIUM_CACHE_DIR=/tmp/chromium-cache \
    GITHUB_TOKEN="$( [ -f /run/secrets/github_token ] && cat /run/secrets/github_token || true )" \
    bash /tmp/install-chromium.sh \
    && TAMPERMONKEY_CACHE_DIR=/tmp/chromium-cache bash /tmp/install-tampermonkey.sh \
    && rm -rf /tmp/chromium-cache /tmp/install-chromium.sh /tmp/install-tampermonkey.sh \
          /tmp/CHROMIUM_VERSION /tmp/CHROMIUM.sha256 /tmp/TAMPERMONKEY.sha256 \
    && mkdir -p /data /etc/chromium/policies/managed

COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/shared /app/shared
COPY --from=build /app/backend /app/backend
COPY --from=build /app/frontend/dist /app/frontend/dist
COPY scripts/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080
VOLUME ["/data"]

ENTRYPOINT ["/app/entrypoint.sh"]
