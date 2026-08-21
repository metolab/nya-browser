#!/bin/bash
set -euo pipefail

export DATA_DIR="${DATA_DIR:-/data}"
export PORT="${PORT:-8080}"
export HOST="${HOST:-0.0.0.0}"
export INIT_ADMIN_USER="${INIT_ADMIN_USER:-admin}"
export INIT_ADMIN_PASSWORD="${INIT_ADMIN_PASSWORD:-${AUTH_PASSWORD:-}}"
export STATIC_DIR="${STATIC_DIR:-/app/frontend/dist}"
export LANG="${LANG:-zh_CN.UTF-8}"
export LC_ALL="${LC_ALL:-zh_CN.UTF-8}"
export NODE_ENV="${NODE_ENV:-production}"

if [ -z "${INIT_ADMIN_PASSWORD}" ]; then
  echo "INIT_ADMIN_PASSWORD (or AUTH_PASSWORD) must be set" >&2
  exit 1
fi

mkdir -p "$DATA_DIR/sessions" /var/run/dbus /run/dbus /var/lib/dbus \
  /etc/chromium/policies/managed /tmp/.X11-unix
chmod 711 "$DATA_DIR/sessions" 2>/dev/null || true
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

if [ ! -s /etc/machine-id ]; then
  if [ -r /proc/sys/kernel/random/uuid ]; then
    tr -d '-' < /proc/sys/kernel/random/uuid > /etc/machine-id
  else
    head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' > /etc/machine-id
  fi
  cp /etc/machine-id /var/lib/dbus/machine-id 2>/dev/null || true
fi

if [ ! -S /run/dbus/system_bus_socket ]; then
  rm -f /run/dbus/pid /var/run/dbus/pid
  dbus-daemon --system --fork || true
fi

mkdir -p /etc/xdg/openbox
if [ ! -f /etc/xdg/openbox/menu.xml ]; then
  cat > /etc/xdg/openbox/menu.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu>
  <menu id="root-menu" label="Openbox">
    <item label="Chromium"><action name="Execute"><command>/opt/nya-chromium/chrome</command></action></item>
  </menu>
</openbox_menu>
XML
fi

cd /app/backend
exec node dist/index.js
