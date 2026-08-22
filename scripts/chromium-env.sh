# Shared Chromium release naming. Source from any script in scripts/.
_nya_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
set -a
. "${_nya_root}/config/chromium.env"
set +a

CHROMIUM_VERSION="$(tr -d ' \n' < "${_nya_root}/browser/VERSION")"
CHROMIUM_RELEASE_TAG="${CHROMIUM_RELEASE_TAG_PREFIX}${CHROMIUM_VERSION}"
CHROMIUM_ASSET="${CHROMIUM_ASSET_PREFIX}${CHROMIUM_VERSION}${CHROMIUM_ASSET_SUFFIX}"
CHROMIUM_DIST_DIR="${_nya_root}/browser/dist"
CHROMIUM_DIST_TAR="${CHROMIUM_DIST_DIR}/${CHROMIUM_ASSET}"
CHROMIUM_CACHE_DIR="${_nya_root}/cache"
CHROMIUM_CACHE_TAR="${CHROMIUM_CACHE_DIR}/${CHROMIUM_ASSET}"
CHROMIUM_SHA256_FILE="${_nya_root}/browser/CHROMIUM.sha256"
NYA_GITHUB_REPO="${NYA_GITHUB_REPO:-metolab/nya-browser}"
