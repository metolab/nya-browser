#!/bin/bash
# Check out the private nya-browser-assets repository (licensed files this public
# repository must not carry, e.g. the Windows fonts) into third_party/assets, at
# the commit pinned in third_party/assets.ref. Images built without it keep the
# aliased Linux fonts for Windows sessions.
#
#   fetch-assets.sh          check out the pinned commit
#   fetch-assets.sh --pin    pin the assets repository's main, then check it out
#
# Access: NYA_ASSETS_SSH_KEY (the read-only deploy key the Image workflow gets
# from the NYA_ASSETS_DEPLOY_KEY secret), otherwise local git/gh credentials.
set -euo pipefail
_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="${NYA_ASSETS_REPO:-metolab/nya-browser-assets}"
DEST="${_root}/third_party/assets"
REF_FILE="${_root}/third_party/assets.ref"

git_args=()
if [ -n "${NYA_ASSETS_SSH_KEY:-}" ]; then
  key="$(mktemp)"
  trap 'rm -f "${key}"' EXIT
  printf '%s\n' "${NYA_ASSETS_SSH_KEY}" > "${key}"
  chmod 600 "${key}"
  export GIT_SSH_COMMAND="ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  url="git@github.com:${REPO}.git"
else
  url="https://github.com/${REPO}.git"
  if command -v gh > /dev/null; then
    git_args=(-c 'credential.https://github.com.helper=!gh auth git-credential')
  fi
fi

if [ "${1:-}" = --pin ]; then
  ref="$(git "${git_args[@]}" ls-remote "${url}" refs/heads/main | cut -f1)"
  [ -n "${ref}" ] || {
    echo "cannot resolve main of ${REPO}" >&2
    exit 1
  }
  echo "${ref}" > "${REF_FILE}"
elif [ -f "${REF_FILE}" ]; then
  ref="$(tr -d ' \n' < "${REF_FILE}")"
else
  echo "assets: none pinned (no ${REF_FILE#"${_root}"/})"
  exit 0
fi

if [ "$(git -C "${DEST}" rev-parse -q --verify HEAD 2> /dev/null || true)" != "${ref}" ]; then
  mkdir -p "${DEST}"
  [ -d "${DEST}/.git" ] || git init -q "${DEST}"
  git -C "${DEST}" "${git_args[@]}" fetch -q --depth 1 "${url}" "${ref}"
  git -C "${DEST}" -c advice.detachedHead=false checkout -q --force FETCH_HEAD
  git -C "${DEST}" clean -qfdx
fi
echo "assets: ${ref:0:12}, windows fonts: $(find "${DEST}/windows-fonts" -maxdepth 1 -type f 2> /dev/null | wc -l)"
