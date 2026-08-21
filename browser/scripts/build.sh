#!/bin/bash
# Build pinned Chromium with Nya farbling patches via ungoogled-chromium-portablelinux.
set -euo pipefail

_nya_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_version="$(tr -d ' \n' < "${_nya_root}/browser/VERSION")"
_tag="${_version}-1"
_vendor="${_nya_root}/browser/.portablelinux"
_dist="${_nya_root}/browser/dist"
_tarball_name="nya-chromium-${_version}-linux64"

mkdir -p "${_dist}" "${_vendor}"

if [ ! -d "${_vendor}/.git" ]; then
  echo "Cloning ungoogled-chromium-portablelinux ${_tag}"
  git clone --depth 1 --branch "${_tag}" --recurse-submodules \
    https://github.com/ungoogled-software/ungoogled-chromium-portablelinux.git \
    "${_vendor}"
else
  echo "Using existing ${_vendor}"
fi

echo "Injecting Nya farbling patches"
mkdir -p "${_vendor}/patches/nya"
cp -f "${_nya_root}/browser/patches/nya/"*.patch "${_vendor}/patches/nya/"
touch "${_vendor}/patches/series"
while IFS= read -r patch || [ -n "${patch}" ]; do
  [ -z "${patch}" ] && continue
  grep -qxF "${patch}" "${_vendor}/patches/series" || echo "${patch}" >> "${_vendor}/patches/series"
done < "${_nya_root}/browser/patches/series"

if ! grep -q 'is_chrome_branded=false' "${_vendor}/flags.linux.gn"; then
  echo >> "${_vendor}/flags.linux.gn"
  cat "${_nya_root}/browser/args.gn" >> "${_vendor}/flags.linux.gn"
fi

_nya_stamp="${_vendor}/build/src/.nya-patches.stamp"
_nya_hash="$(cat "${_nya_root}/browser/patches/series" "${_nya_root}/browser/patches/nya/"*.patch | sha256sum | awk '{print $1}')"
_nya_hook="${_vendor}/build/src/third_party/blink/renderer/platform/nya/nya_farbling.cc"
if [ -f "${_nya_hook}" ]; then
  # Sources already have Nya patches; skip prune/re-apply.
  mkdir -p "${_vendor}/build/src"
  touch "${_vendor}/build/src/.patched.stamp"
  echo "${_nya_hash}" > "${_nya_stamp}"
elif [ ! -f "${_nya_stamp}" ] || [ "$(cat "${_nya_stamp}" 2>/dev/null || true)" != "${_nya_hash}" ]; then
  rm -f "${_vendor}/build/src/.patched.stamp"
fi

echo "Building Chromium ${_version} (this takes hours)"
if [ -f "${_nya_root}/browser/Dockerfile.build" ]; then
  mkdir -p "${_vendor}/docker"
  cp -f "${_nya_root}/browser/Dockerfile.build" "${_vendor}/docker/build.Dockerfile"
  # portablelinux COPY metrics.cfg; keep theirs if present.
fi
"${_vendor}/scripts/docker-build.sh" "$@"

_out="${_vendor}/build/src/out/Default"
if [ ! -x "${_out}/chrome" ]; then
  echo "Build finished but ${_out}/chrome is missing" >&2
  exit 1
fi

echo "${_nya_hash}" > "${_nya_stamp}"

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
