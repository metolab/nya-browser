#!/bin/bash
# Upload locally built Chromium tarball to GitHub Releases.
# Tag: chromium-$VERSION   Asset: nya-chromium-$VERSION-linux64.tar.xz
#
# Requires: gh (GitHub CLI), authenticated to NYA_GITHUB_REPO.
set -euo pipefail
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "${_here}/chromium-env.sh"

if [ ! -f "${CHROMIUM_DIST_TAR}" ]; then
  echo "Missing ${CHROMIUM_DIST_TAR}" >&2
  echo "Build it first: bash browser/scripts/build.sh" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh (GitHub CLI) is required" >&2
  exit 1
fi

REPO="${NYA_GITHUB_REPO}"
NOTES="Prebuilt nya-chromium ${CHROMIUM_VERSION} (linux64). Used by Docker/CI; this release is not an application build."

if gh release view "${CHROMIUM_RELEASE_TAG}" --repo "${REPO}" >/dev/null 2>&1; then
  echo "Updating existing release ${CHROMIUM_RELEASE_TAG}"
  gh release upload "${CHROMIUM_RELEASE_TAG}" "${CHROMIUM_DIST_TAR}" \
    --repo "${REPO}" --clobber
else
  echo "Creating release ${CHROMIUM_RELEASE_TAG}"
  gh release create "${CHROMIUM_RELEASE_TAG}" "${CHROMIUM_DIST_TAR}" \
    --repo "${REPO}" \
    --title "Chromium ${CHROMIUM_VERSION}" \
    --notes "${NOTES}"
fi

SHA_FILE="${_nya_root}/browser/CHROMIUM.sha256"
sha256sum "${CHROMIUM_DIST_TAR}" | awk -v name="${CHROMIUM_ASSET}" '{print $1 "  " name}' > "${SHA_FILE}"
echo "Updated ${SHA_FILE}"
echo "Commit browser/CHROMIUM.sha256 so Image CI busts the Chromium layer."
echo "Published ${CHROMIUM_ASSET} to ${REPO}@${CHROMIUM_RELEASE_TAG}"
