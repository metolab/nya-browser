#!/bin/bash
# Build pinned Chromium with the Nya sources via ungoogled-chromium-portablelinux.
# The tree is reset to nya-base and patched from browser/src + browser/patches
# on every run (browser/scripts/patches.sh), so the binary always matches git.
# out/ is kept (only changed sources recompile); --clean builds from scratch.
#
#   bash browser/scripts/build.sh [--clean]
set -euo pipefail

_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${_here}/lib.sh"
_tarball_name="nya-chromium-${_version}-linux64"

ensure_vendor
if [ ! -d "${_src}/.git" ]; then
  "${_here}/patches.sh" prep
  "${_here}/patches.sh" init
fi
"${_here}/patches.sh" apply

echo "Building Chromium ${_version} (a clean build takes hours)"
clear_esbuild_link
_build_start="$(date)"
run_builder build.sh "$@"
echo "Build started at ${_build_start}, ended at $(date)"

_out="${_vendor}/build/src/out/Default"
if [ ! -x "${_out}/chrome" ]; then
  echo "Build finished but ${_out}/chrome is missing" >&2
  exit 1
fi

_stage="${_dist}/${_tarball_name}"
rm -rf "${_stage}"
mkdir -p "${_stage}"

_files="chrome chrome_100_percent.pak chrome_200_percent.pak chrome_crashpad_handler
chromedriver chrome-wrapper icudtl.dat libEGL.so libGLESv2.so libqt5_shim.so libqt6_shim.so
libvk_swiftshader.so libvulkan.so.1 locales product_logo_48.png resources.pak
v8_context_snapshot.bin vk_swiftshader_icd.json xdg-mime xdg-settings icudtl.dat"

for file in $_files; do
  if [ -e "${_out}/${file}" ]; then
    cp -a "${_out}/${file}" "${_stage}/"
  fi
done
# SwiftShader / ANGLE extras
find "${_out}" -maxdepth 1 \( -name '*.so' -o -name '*.so.*' \) | while read -r so; do
  cp -a "${so}" "${_stage}/" 2>/dev/null || true
done

tar -C "${_dist}" -cJf "${_dist}/${_tarball_name}.tar.xz" "${_tarball_name}"
echo "Wrote ${_dist}/${_tarball_name}.tar.xz"
ls -lh "${_dist}/${_tarball_name}.tar.xz"
echo "Next: bash scripts/publish-chromium.sh   # upload to GitHub Release"
echo "  or: bash scripts/stage-chromium.sh     # use tarball for local docker build"
