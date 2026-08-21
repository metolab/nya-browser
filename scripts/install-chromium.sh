#!/bin/bash
# Install nya-chromium into CHROMIUM_PREFIX (default /opt/nya-chromium).
# Resolution order:
#   1. CHROMIUM_URL
#   2. tarball in CHROMIUM_CACHE_DIR (staged by scripts/stage-chromium.sh)
#   3. GitHub Release asset on NYA_GITHUB_REPO
set -euo pipefail

CHROMIUM_PREFIX="${CHROMIUM_PREFIX:-/opt/nya-chromium}"
CHROMIUM_CACHE_DIR="${CHROMIUM_CACHE_DIR:-/tmp/chromium-cache}"
NYA_GITHUB_REPO="${NYA_GITHUB_REPO:-metolab/nya-browser}"

if [ -z "${CHROMIUM_VERSION:-}" ] && [ -f /tmp/CHROMIUM_VERSION ]; then
  CHROMIUM_VERSION="$(tr -d ' \n' < /tmp/CHROMIUM_VERSION)"
fi
CHROMIUM_VERSION="${CHROMIUM_VERSION:?CHROMIUM_VERSION is required}"

ASSET="nya-chromium-${CHROMIUM_VERSION}-linux64.tar.xz"
TAG="chromium-${CHROMIUM_VERSION}"
DEST_TAR="/tmp/${ASSET}"

found=""
if [ -n "${CHROMIUM_URL:-}" ]; then
  echo "Downloading Chromium from CHROMIUM_URL"
  curl -fsSL -L ${GITHUB_TOKEN:+-H "Authorization: Bearer ${GITHUB_TOKEN}"} \
    -o "${DEST_TAR}" "${CHROMIUM_URL}"
  found=1
elif [ -f "${CHROMIUM_CACHE_DIR}/${ASSET}" ]; then
  echo "Using staged Chromium ${CHROMIUM_CACHE_DIR}/${ASSET}"
  cp -a "${CHROMIUM_CACHE_DIR}/${ASSET}" "${DEST_TAR}"
  found=1
elif [ -f "${CHROMIUM_CACHE_DIR}/nya-chromium.tar.xz" ]; then
  echo "Using staged Chromium ${CHROMIUM_CACHE_DIR}/nya-chromium.tar.xz"
  cp -a "${CHROMIUM_CACHE_DIR}/nya-chromium.tar.xz" "${DEST_TAR}"
  found=1
else
  URL="https://github.com/${NYA_GITHUB_REPO}/releases/download/${TAG}/${ASSET}"
  echo "Downloading Chromium from ${URL}"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    API="https://api.github.com/repos/${NYA_GITHUB_REPO}/releases/tags/${TAG}"
    ASSET_API_URL="$(
      curl -fsSL \
        -H "Authorization: Bearer ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "${API}" \
      | ASSET="${ASSET}" node -e '
          let d = "";
          process.stdin.on("data", (c) => { d += c; });
          process.stdin.on("end", () => {
            const j = JSON.parse(d);
            const name = process.env.ASSET;
            const a = (j.assets || []).find((x) => x.name === name);
            if (!a || !a.url) process.exit(2);
            process.stdout.write(a.url);
          });
        '
    )"
    curl -fsSL -L \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/octet-stream" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -o "${DEST_TAR}" "${ASSET_API_URL}"
  else
    curl -fsSL -L -o "${DEST_TAR}" "${URL}"
  fi
  found=1
fi

if [ -z "${found}" ] || [ ! -s "${DEST_TAR}" ]; then
  echo "Chromium tarball is missing or empty" >&2
  exit 1
fi

rm -rf "${CHROMIUM_PREFIX}" /opt/nya-chromium-"${CHROMIUM_VERSION}"-linux64
mkdir -p /opt
tar -xJf "${DEST_TAR}" -C /opt
if [ -d "/opt/nya-chromium-${CHROMIUM_VERSION}-linux64" ]; then
  mv "/opt/nya-chromium-${CHROMIUM_VERSION}-linux64" "${CHROMIUM_PREFIX}"
elif [ -d /opt/nya-chromium ]; then
  :
else
  echo "Unexpected tarball layout" >&2
  tar -tf "${DEST_TAR}" | head >&2
  exit 1
fi
chmod +x "${CHROMIUM_PREFIX}/chrome"
rm -f "${DEST_TAR}"
echo "Installed ${CHROMIUM_PREFIX}/chrome"
