#!/bin/bash
# Unpack Google's Widevine CDM component into WIDEVINE_DIR (default /opt/nya-widevine).
# Sessions point Chromium at it through the WidevineCdm hint file in their user data dir.
# Resolution order:
#   1. WIDEVINE_CRX (existing file)
#   2. WIDEVINE_CACHE_DIR/widevine.crx3
#   3. Download from Google's component CDN
set -euo pipefail

WIDEVINE_DIR="${WIDEVINE_DIR:-/opt/nya-widevine}"
WIDEVINE_CACHE_DIR="${WIDEVINE_CACHE_DIR:-/tmp/chromium-cache}"
WIDEVINE_URL="${WIDEVINE_URL:-https://edgedl.me.gvt1.com/edgedl/release2/chrome_component/acqexsh26ysyu3zxeotqtsp63idq_4.10.3112.0/oimompecagnajdejgnnjijobebaeigek_4.10.3112.0_linux64_ad7kyx4q7wx7xknykmkbonbbmnwq.crx3}"

if [ -z "${WIDEVINE_SHA256:-}" ] && [ -f /tmp/WIDEVINE.sha256 ]; then
  WIDEVINE_SHA256="$(awk 'NF && $1 !~ /^#/ { print $1; exit }' /tmp/WIDEVINE.sha256)"
fi
WIDEVINE_SHA256="${WIDEVINE_SHA256:?WIDEVINE_SHA256 or /tmp/WIDEVINE.sha256 is required}"
WIDEVINE_SHA256="${WIDEVINE_SHA256#sha256:}"

DEST_CRX="/tmp/widevine.crx3"
if [ -n "${WIDEVINE_CRX:-}" ] && [ -f "${WIDEVINE_CRX}" ]; then
  echo "Using Widevine CRX ${WIDEVINE_CRX}"
  cp -a "${WIDEVINE_CRX}" "${DEST_CRX}"
elif [ -f "${WIDEVINE_CACHE_DIR}/widevine.crx3" ]; then
  echo "Using staged Widevine ${WIDEVINE_CACHE_DIR}/widevine.crx3"
  cp -a "${WIDEVINE_CACHE_DIR}/widevine.crx3" "${DEST_CRX}"
else
  echo "Downloading Widevine from ${WIDEVINE_URL}"
  curl -fsSL -L -o "${DEST_CRX}" "${WIDEVINE_URL}"
fi

if [ ! -s "${DEST_CRX}" ]; then
  echo "Widevine CRX is missing or empty" >&2
  exit 1
fi

actual="$(sha256sum "${DEST_CRX}" | awk '{print $1}')"
if [ "${actual}" != "${WIDEVINE_SHA256}" ]; then
  echo "Widevine CRX sha256 mismatch (expected ${WIDEVINE_SHA256}, got ${actual})" >&2
  exit 1
fi
echo "Verified Widevine sha256 ${actual}"

python3 - "${DEST_CRX}" "${WIDEVINE_DIR}" <<'PY'
import io, json, shutil, struct, sys, zipfile
from pathlib import Path

crx_path, dest_dir = sys.argv[1], sys.argv[2]
raw = Path(crx_path).read_bytes()
if raw[:4] != b"Cr24" or struct.unpack_from("<I", raw, 4)[0] != 3:
    raise SystemExit(f"Not a CRX3: {crx_path}")
header_size = struct.unpack_from("<I", raw, 8)[0]
dest = Path(dest_dir)
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir(parents=True)
with zipfile.ZipFile(io.BytesIO(raw[12 + header_size :])) as zf:
    zf.extractall(dest)

lib = dest / "_platform_specific" / "linux_x64" / "libwidevinecdm.so"
if not lib.is_file():
    raise SystemExit(f"Widevine CRX has no {lib.relative_to(dest)}")
manifest = json.loads((dest / "manifest.json").read_text())
print(f"Installed Widevine {manifest.get('version')} -> {dest}")
PY

chmod -R a+rX "${WIDEVINE_DIR}"
rm -f "${DEST_CRX}"
