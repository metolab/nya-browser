#!/bin/bash
# Copy the locally built Chromium tarball into cache/ so Docker can COPY it
# without sending browser/.portablelinux or unpacking the tree.
set -euo pipefail
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${_here}/chromium-env.sh"

if [ ! -f "${CHROMIUM_DIST_TAR}" ]; then
  echo "Missing ${CHROMIUM_DIST_TAR}" >&2
  echo "Build it first: bash browser/scripts/build.sh" >&2
  exit 1
fi

mkdir -p "${CHROMIUM_CACHE_DIR}"
cp -a "${CHROMIUM_DIST_TAR}" "${CHROMIUM_CACHE_TAR}"
echo "Staged ${CHROMIUM_CACHE_TAR}"
ls -lh "${CHROMIUM_CACHE_TAR}"
