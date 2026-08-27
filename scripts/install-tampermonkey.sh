#!/bin/bash
# Unpack official Tampermonkey into TAMPERMONKEY_DIR (default /opt/nya-extensions/tampermonkey).
# Resolution order:
#   1. TAMPERMONKEY_CRX (existing file)
#   2. TAMPERMONKEY_CACHE_DIR/tampermonkey_stable.crx
#   3. Download from tampermonkey.net
set -euo pipefail

TAMPERMONKEY_DIR="${TAMPERMONKEY_DIR:-/opt/nya-extensions/tampermonkey}"
TAMPERMONKEY_CACHE_DIR="${TAMPERMONKEY_CACHE_DIR:-/tmp/chromium-cache}"
TAMPERMONKEY_URL="${TAMPERMONKEY_URL:-https://www.tampermonkey.net/crx/tampermonkey_stable.crx}"
# Chrome Web Store public key for dhdgffkkebhmkfjojejmpbldmpobfkfo
TAMPERMONKEY_KEY='MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDjiyuc6OWY8gaVTe+b16fH2BBe0PQLMeUpEXSQvyv5a/6OiQ1D8bBLTfLvApD3zT2MZoXWu2KUILdkyg5OC/Tru8m+Js6e3RjHY9Rqbvnh8CJQgTJ+63L5w9aLsTvA2fqdDfhw8Mnl1GMcJd/RI/ZiBEm0stog0ZfyQjD1jpSEXQIDAQAB'

if [ -z "${TAMPERMONKEY_SHA256:-}" ] && [ -f /tmp/TAMPERMONKEY.sha256 ]; then
  TAMPERMONKEY_SHA256="$(awk 'NF && $1 !~ /^#/ { print $1; exit }' /tmp/TAMPERMONKEY.sha256)"
fi
TAMPERMONKEY_SHA256="${TAMPERMONKEY_SHA256:?TAMPERMONKEY_SHA256 or /tmp/TAMPERMONKEY.sha256 is required}"
TAMPERMONKEY_SHA256="${TAMPERMONKEY_SHA256#sha256:}"

DEST_CRX="/tmp/tampermonkey_stable.crx"
found=""
if [ -n "${TAMPERMONKEY_CRX:-}" ] && [ -f "${TAMPERMONKEY_CRX}" ]; then
  echo "Using Tampermonkey CRX ${TAMPERMONKEY_CRX}"
  cp -a "${TAMPERMONKEY_CRX}" "${DEST_CRX}"
  found=1
elif [ -f "${TAMPERMONKEY_CACHE_DIR}/tampermonkey_stable.crx" ]; then
  echo "Using staged Tampermonkey ${TAMPERMONKEY_CACHE_DIR}/tampermonkey_stable.crx"
  cp -a "${TAMPERMONKEY_CACHE_DIR}/tampermonkey_stable.crx" "${DEST_CRX}"
  found=1
else
  echo "Downloading Tampermonkey from ${TAMPERMONKEY_URL}"
  curl -fsSL -L -A "Mozilla/5.0" -o "${DEST_CRX}" "${TAMPERMONKEY_URL}"
  found=1
fi

if [ -z "${found}" ] || [ ! -s "${DEST_CRX}" ]; then
  echo "Tampermonkey CRX is missing or empty" >&2
  exit 1
fi

actual="$(sha256sum "${DEST_CRX}" | awk '{print $1}')"
if [ "${actual}" != "${TAMPERMONKEY_SHA256}" ]; then
  echo "Tampermonkey CRX sha256 mismatch (expected ${TAMPERMONKEY_SHA256}, got ${actual})" >&2
  exit 1
fi
echo "Verified Tampermonkey sha256 ${actual}"

python3 - "${DEST_CRX}" "${TAMPERMONKEY_DIR}" "${TAMPERMONKEY_KEY}" <<'PY'
import json, struct, sys, zipfile, io
from pathlib import Path

crx_path, dest_dir, public_key = sys.argv[1], sys.argv[2], sys.argv[3]
raw = Path(crx_path).read_bytes()
if raw[:4] != b"Cr24":
    raise SystemExit(f"Not a CRX: {crx_path}")
version = struct.unpack_from("<I", raw, 4)[0]
if version != 3:
    raise SystemExit(f"Unsupported CRX version {version}")
header_size = struct.unpack_from("<I", raw, 8)[0]
payload = raw[12 + header_size :]
dest = Path(dest_dir)
if dest.exists():
    import shutil
    shutil.rmtree(dest)
dest.mkdir(parents=True)
with zipfile.ZipFile(io.BytesIO(payload)) as zf:
    zf.extractall(dest)

manifest_path = dest / "manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest["key"] = public_key
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

bg_path = dest / "background.js"
bg = bg_path.read_text()
old = 'un={enabled:!0,configMode:0,debug:!1,logLevel:0,showFixedSrc:!1,webrequest_modHeaders:"yes",webrequest_fixCSP:"auto",webrequest_fixContentCSP:"no",notification_showUpdate:"changelog"'
new = 'un={enabled:!0,configMode:100,debug:!1,logLevel:0,showFixedSrc:!1,webrequest_modHeaders:"yes",webrequest_fixCSP:"auto",webrequest_fixContentCSP:"no",notification_showUpdate:"off"'
if old not in bg:
    raise SystemExit("Tampermonkey defaults not found; installer needs an update")
bg_path.write_text(bg.replace(old, new, 1))
print(f"Installed Tampermonkey {manifest.get('version')} -> {dest}")
PY

chmod -R a+rX "${TAMPERMONKEY_DIR}"
rm -f "${DEST_CRX}"
echo "Installed ${TAMPERMONKEY_DIR}"
