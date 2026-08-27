#!/bin/bash
# Install sing-box into SINGBOX_PREFIX (default /usr/local/bin).
# Resolution order:
#   1. SINGBOX_URL
#   2. tarball in SINGBOX_CACHE_DIR
#   3. GitHub release SagerNet/sing-box
set -euo pipefail

SINGBOX_PREFIX="${SINGBOX_PREFIX:-/usr/local/bin}"
SINGBOX_CACHE_DIR="${SINGBOX_CACHE_DIR:-/tmp/singbox-cache}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -z "${SINGBOX_VERSION:-}" ] && [ -f "${ROOT_DIR}/third_party/sing-box/VERSION" ]; then
  SINGBOX_VERSION="$(tr -d ' \n' < "${ROOT_DIR}/third_party/sing-box/VERSION")"
fi
if [ -z "${SINGBOX_VERSION:-}" ] && [ -f /tmp/SINGBOX_VERSION ]; then
  SINGBOX_VERSION="$(tr -d ' \n' < /tmp/SINGBOX_VERSION)"
fi
SINGBOX_VERSION="${SINGBOX_VERSION:?SINGBOX_VERSION is required}"

arch="$(uname -m)"
case "${arch}" in
  x86_64|amd64) SINGBOX_GOARCH=amd64 ;;
  aarch64|arm64) SINGBOX_GOARCH=arm64 ;;
  *)
    echo "Unsupported architecture: ${arch}" >&2
    exit 1
    ;;
esac

ASSET="sing-box-${SINGBOX_VERSION}-linux-${SINGBOX_GOARCH}.tar.gz"
DEST_TAR="/tmp/${ASSET}"
SHA_FILE="${ROOT_DIR}/third_party/sing-box/SHA256"
if [ ! -f "${SHA_FILE}" ] && [ -f /tmp/SINGBOX.sha256 ]; then
  SHA_FILE=/tmp/SINGBOX.sha256
fi

found=""
if [ -n "${SINGBOX_URL:-}" ]; then
  echo "Downloading sing-box from SINGBOX_URL"
  curl -fsSL -L -o "${DEST_TAR}" "${SINGBOX_URL}"
  found=1
elif [ -f "${SINGBOX_CACHE_DIR}/${ASSET}" ]; then
  echo "Using staged sing-box ${SINGBOX_CACHE_DIR}/${ASSET}"
  cp -a "${SINGBOX_CACHE_DIR}/${ASSET}" "${DEST_TAR}"
  found=1
else
  URL="https://github.com/SagerNet/sing-box/releases/download/v${SINGBOX_VERSION}/${ASSET}"
  echo "Downloading sing-box from ${URL}"
  curl -fsSL -L -o "${DEST_TAR}" "${URL}"
  found=1
fi

if [ -z "${found}" ] || [ ! -s "${DEST_TAR}" ]; then
  echo "sing-box tarball is missing or empty" >&2
  exit 1
fi

if [ -f "${SHA_FILE}" ]; then
  expected="$(awk -v name="${ASSET}" '$2 == name { print $1; exit }' "${SHA_FILE}")"
  expected="${expected#sha256:}"
  if [ -n "${expected}" ]; then
    actual="$(sha256sum "${DEST_TAR}" | awk '{ print $1 }')"
    if [ "${actual}" != "${expected}" ]; then
      echo "sing-box checksum mismatch: expected ${expected} got ${actual}" >&2
      exit 1
    fi
  fi
fi

workdir="$(mktemp -d)"
tar -xzf "${DEST_TAR}" -C "${workdir}"
bin="$(find "${workdir}" -type f -name sing-box | head -n 1)"
if [ -z "${bin}" ]; then
  echo "sing-box binary missing from archive" >&2
  exit 1
fi
mkdir -p "${SINGBOX_PREFIX}"
install -m 0755 "${bin}" "${SINGBOX_PREFIX}/sing-box"
rm -rf "${workdir}" "${DEST_TAR}"
echo "Installed sing-box ${SINGBOX_VERSION} to ${SINGBOX_PREFIX}/sing-box"
"${SINGBOX_PREFIX}/sing-box" version
