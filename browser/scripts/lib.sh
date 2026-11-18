#!/bin/bash
# Shared paths and helpers for browser/scripts/{build,patches}.sh.

_nya_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_version="$(tr -d ' \n' < "${_nya_root}/browser/VERSION")"
_tag="${_version}-1"
_vendor="${_nya_root}/browser/.portablelinux"
_src="${_vendor}/build/src"
_dist="${_nya_root}/browser/dist"
_overlay="${_nya_root}/browser/portablelinux"
_nya_patches="${_nya_root}/browser/patches"
_nya_files="${_nya_root}/browser/src"
_builder_image="chromium-builder:trixie-slim"
_portable_url="https://github.com/ungoogled-software/ungoogled-chromium-portablelinux.git"

die() {
  echo "error: $*" >&2
  exit 1
}

# Clone ungoogled-chromium-portablelinux for browser/VERSION and point its
# series at the portablelinux patches only; Nya patches are applied by
# patches.sh on top of the git-tracked tree.
ensure_vendor() {
  mkdir -p "${_dist}"
  if [ ! -d "${_vendor}/.git" ]; then
    if [ -f "${_overlay}/series" ]; then
      # No portablelinux release for this version yet: pinned portablelinux
      # commit, ungoogled-chromium submodule at the release tag, and the Nya
      # overlay series (refreshed portablelinux patches).
      local commit
      commit="$(tr -d ' \n' < "${_overlay}/COMMIT")"
      echo "Cloning ungoogled-chromium-portablelinux ${commit} + ungoogled-chromium ${_tag}"
      git clone "${_portable_url}" "${_vendor}"
      git -C "${_vendor}" checkout --detach "${commit}"
      git -C "${_vendor}" submodule update --init
      git -C "${_vendor}/ungoogled-chromium" fetch --depth 1 origin tag "${_tag}"
      git -C "${_vendor}/ungoogled-chromium" checkout --detach "${_tag}"
    else
      echo "Cloning ungoogled-chromium-portablelinux ${_tag}"
      git clone --depth 1 --branch "${_tag}" --recurse-submodules "${_portable_url}" "${_vendor}"
    fi
  fi

  rm -rf "${_vendor}/patches/nya"
  if [ -f "${_overlay}/series" ]; then
    mkdir -p "${_vendor}/patches/nya-portable"
    cp -f "${_overlay}/patches/"*.patch "${_vendor}/patches/nya-portable/"
    cp -f "${_overlay}/series" "${_vendor}/patches/series"
    [ -f "${_overlay}/flags.linux.gn" ] && cp -f "${_overlay}/flags.linux.gn" "${_vendor}/flags.linux.gn"
  else
    git -C "${_vendor}" checkout -- patches/series
  fi

  while IFS= read -r arg || [ -n "${arg}" ]; do
    case "${arg}" in '' | '#'*) continue ;; esac
    grep -qxF "${arg}" "${_vendor}/flags.linux.gn" || echo "${arg}" >> "${_vendor}/flags.linux.gn"
  done < "${_nya_root}/browser/args.gn"

  mkdir -p "${_vendor}/docker"
  cp -f "${_nya_root}/browser/Dockerfile.build" "${_vendor}/docker/build.Dockerfile"
}

# portablelinux runs `rm -rf node_modules/esbuild/` before relinking it; with a
# symlink left by an earlier run, that empties the image's global esbuild.
clear_esbuild_link() {
  local link="${_src}/third_party/devtools-frontend/src/node_modules/esbuild"
  if [ -L "${link}" ]; then rm -f "${link}"; fi
}

# Run browser/scripts/container/<script> in the portablelinux builder image
# with the vendor checkout mounted at /repo.
run_builder() {
  local script="$1"
  shift
  if [ -z "${_use_existing_image:-}" ] || ! docker image inspect "${_builder_image}" > /dev/null 2>&1; then
    (cd "${_vendor}/docker" && docker buildx build --load -t "${_builder_image}" -f ./build.Dockerfile .)
  fi
  mkdir -p "${_vendor}/nya"
  cp -f "${_nya_root}/browser/scripts/container/"*.sh "${_vendor}/nya/"
  docker run --rm -u "$(id -u):$(id -g)" -v "${_vendor}:/repo" "${_builder_image}" \
    bash "/repo/nya/${script}" "$@"
}
