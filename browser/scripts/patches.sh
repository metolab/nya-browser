#!/bin/bash
# Maintain the Nya sources on a git-tracked Chromium tree (browser/.portablelinux/build/src).
#
#   patches.sh prep             unpack, prune, apply ungoogled + portablelinux patches
#   patches.sh init             commit that tree in full and tag it nya-base
#   patches.sh apply [--force]  reset to nya-base, add browser/src, apply the series, domsub
#   patches.sh export           write the commits back to browser/src and browser/patches
#   patches.sh check            compile only the objects Nya touches
#   patches.sh rebase OLD_SRC   replay the Nya commits of an older tree onto this one
#   patches.sh rebase --finish  after resolving conflicts and `git rebase --continue`
#
# History on top of nya-base: "nya/files" (files Chromium does not have, kept in
# browser/src), one "nya/<name>.patch" commit per line of the series, and
# "nya/domsub" (upstream domain substitution, never exported; it must stay last).
# Edit, commit with `git commit --fixup` / `git rebase -i --autosquash nya-base`,
# then export.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

g() {
  git -C "${_src}" -c core.quotePath=false "$@"
}

gdiff() {
  g -c diff.noprefix=false -c diff.mnemonicPrefix=false diff --no-color --no-ext-diff --no-renames "$@"
}

require_tree() {
  [ -d "${_src}/.git" ] || die "no git tree at ${_src}; run: patches.sh prep && patches.sh init"
  g rev-parse -q --verify refs/tags/nya-base > /dev/null || die "tag nya-base missing in ${_src}"
}

subject_of() {
  g log -1 --format=%s "$1"
}

# Last Nya commit below nya/domsub.
patch_top() {
  if [ "$(subject_of HEAD)" = nya/domsub ]; then
    echo HEAD^
  else
    echo HEAD
  fi
}

has_local_edits() {
  # Trees from before nya/domsub carry the substitution uncommitted.
  if [ -f "${_src}/.domsub.stamp" ] && [ "$(subject_of HEAD)" != nya/domsub ]; then
    return 1
  fi
  # setup_toolchain replaces this directory with a link to the image's esbuild.
  ! g diff --quiet HEAD -- . ':(exclude)third_party/devtools-frontend/src/node_modules/esbuild'
}

# Record mtime and content hash of every file that differs from nya-base, so
# files whose content survives a re-apply keep their mtime (no rebuild).
save_mtimes() {
  g diff --name-only --no-renames -z nya-base | python3 -c '
import hashlib, os, sys
os.chdir(sys.argv[1])
with open(sys.argv[2], "w") as out:
    for f in sys.stdin.buffer.read().split(b"\0"):
        if not f or not os.path.isfile(f):
            continue
        st = os.stat(f)
        with open(f, "rb") as fh:
            h = hashlib.sha1(fh.read()).hexdigest()
        out.write("%d %d %s %s\n" % (st.st_atime_ns, st.st_mtime_ns, h, f.hex()))
' "${_src}" "$1"
}

restore_mtimes() {
  python3 -c '
import hashlib, os, sys
os.chdir(sys.argv[1])
kept = 0
for line in open(sys.argv[2]):
    atime, mtime, h, f = line.split()
    f = bytes.fromhex(f)
    if not os.path.isfile(f):
        continue
    with open(f, "rb") as fh:
        if hashlib.sha1(fh.read()).hexdigest() != h:
            continue
    os.utime(f, ns=(int(atime), int(mtime)))
    kept += 1
print("Kept the mtime of %d unchanged files" % kept)
' "${_src}" "$1"
}

cmd_prep() {
  ensure_vendor
  [ ! -e "${_src}/.git" ] || die "${_src} is already tracked"
  run_builder prep.sh
}

cmd_init() {
  [ -f "${_src}/.patched.stamp" ] || die "sources not prepared; run: patches.sh prep"
  [ ! -f "${_src}/.domsub.stamp" ] || die "domain substitution already applied; prepare a fresh tree"
  [ ! -d "${_src}/.git" ] || die "${_src} is already tracked"
  git init -q -b master "${_src}"
  g config user.name nya
  g config user.email nya@localhost
  g config core.autocrlf false
  g config core.untrackedCache true
  g config status.showUntrackedFiles no
  g config rerere.enabled true
  g config gc.auto 0
  printf '%s\n' '/out/' '/.*.stamp' > "${_src}/.git/info/exclude"
  # Byte-exact checkouts: the tree's .gitattributes must not convert anything.
  echo '* -text -eol -filter -ident -working-tree-encoding' > "${_src}/.git/info/attributes"
  echo "Committing ${_src} (a few minutes)"
  g add -A -f -- . ':(exclude)out' ':(exclude,glob).*.stamp'
  g commit -q -m "base ${_tag}"
  g tag -f nya-base > /dev/null
}

# Write the series, patches and own files of nya-base..HEAD below $1.
export_to() {
  local dest="$1" own="$1/own.txt" paths="$1/paths.txt" seen="$1/seen.txt"
  mkdir -p "${dest}/patches/nya" "${dest}/src"
  : > "${dest}/patches/series"
  : > "${seen}"

  # Files nya-base does not have are Nya's own sources.
  local top
  top="$(patch_top)"
  g diff --name-only --no-renames --diff-filter=A nya-base "${top}" > "${own}"
  while IFS= read -r f; do
    mkdir -p "${dest}/src/$(dirname "${f}")"
    g show "${top}:${f}" > "${dest}/src/${f}"
  done < "${own}"

  local c subject
  for c in $(g rev-list --reverse nya-base..HEAD); do
    subject="$(subject_of "${c}")"
    case "${subject}" in
      nya/files) continue ;;
      nya/domsub)
        [ "$(g rev-parse "${c}")" = "$(g rev-parse HEAD)" ] ||
          die "commits on top of nya/domsub; move them below it (git rebase -i nya-base)"
        continue
        ;;
      nya/*.patch) ;;
      *) die "commit ${c:0:12} '${subject}' is not a patch commit; squash it (git rebase -i --autosquash nya-base)" ;;
    esac
    if grep -qxF "${subject}" "${dest}/patches/series"; then
      die "two commits named ${subject}; squash them (git rebase -i --autosquash nya-base)"
    fi
    g diff --name-only --no-renames "${c}^" "${c}" | grep -vxF -f "${own}" > "${paths}" || true
    [ -s "${paths}" ] || continue
    local p=()
    mapfile -t p < "${paths}"
    gdiff "${c}^" "${c}" -- "${p[@]}" > "${dest}/patches/${subject}"
    echo "${subject}" >> "${dest}/patches/series"
    local f
    for f in "${p[@]}"; do
      if grep -q "^${f} " "${seen}"; then
        echo "warning: ${f} is changed by $(grep "^${f} " "${seen}" | cut -d' ' -f2) and ${subject}" >&2
      fi
      echo "${f} ${subject}" >> "${seen}"
    done
  done
}

check_exported() {
  local tmp
  tmp="$(mktemp -d)"
  export_to "${tmp}"
  if ! diff -r -q "${tmp}/patches" "${_nya_patches}" > /dev/null ||
    ! diff -r -q "${tmp}/src" "${_nya_files}" > /dev/null 2>&1; then
    rm -rf "${tmp}"
    die "commits in ${_src} differ from browser/patches and browser/src; run: patches.sh export (or apply --force to drop them)"
  fi
  rm -rf "${tmp}"
}

cmd_apply() {
  require_tree
  local force="${1:-}"
  if [ "${force}" != "--force" ]; then
    has_local_edits && die "uncommitted changes in ${_src}; commit and export them, or pass --force"
    [ "$(g rev-parse HEAD)" = "$(g rev-parse nya-base)" ] || check_exported
  fi
  [ "$(g rev-parse HEAD)" = "$(g rev-parse nya-base)" ] || g branch -f nya-prev HEAD
  # Taken after the last apply, so a rebase or reset since then does not
  # make ninja rebuild files whose content ends up the same.
  local mtimes="${_src}/.git/nya-mtimes"
  [ -f "${mtimes}" ] || save_mtimes "${mtimes}"
  clear_esbuild_link
  g checkout -q -f -B master nya-base
  rm -f "${_src}/.domsub.stamp"

  if [ -d "${_nya_files}" ]; then
    (cd "${_nya_files}" && tar cf - .) | (cd "${_src}" && tar xmf -)
    (cd "${_nya_files}" && find . -type f -printf '%P\n') | g add -f --pathspec-from-file=-
    g commit -q -m "nya/files"
  fi

  local patch
  while IFS= read -r patch || [ -n "${patch}" ]; do
    case "${patch}" in '' | '#'*) continue ;; esac
    g apply --index --whitespace=nowarn "${_nya_patches}/${patch}" ||
      die "${patch} does not apply to ${_tag}; port it with: patches.sh rebase OLD_SRC"
    g commit -q -m "${patch}"
  done < "${_nya_patches}/series"
  touch "${_src}/.patched.stamp"
  echo "Applied browser/src and $(grep -cv '^\s*\(#\|$\)' "${_nya_patches}/series") patches onto nya-base"

  echo "Applying domain substitution"
  ensure_vendor
  run_builder domsub.sh
  g add -u
  g commit -q --allow-empty -m nya/domsub
  restore_mtimes "${mtimes}"
  save_mtimes "${mtimes}"
}

cmd_export() {
  require_tree
  if has_local_edits; then
    echo "warning: uncommitted changes in ${_src} are not exported" >&2
  fi
  local tmp
  tmp="$(mktemp -d)"
  export_to "${tmp}"
  rm -rf "${_nya_patches}/nya" "${_nya_files}"
  mkdir -p "${_nya_patches}/nya"
  cp -f "${tmp}/patches/series" "${_nya_patches}/series"
  if compgen -G "${tmp}/patches/nya/*.patch" > /dev/null; then
    cp -f "${tmp}/patches/nya/"*.patch "${_nya_patches}/nya/"
  fi
  if [ -s "${tmp}/own.txt" ]; then
    cp -a "${tmp}/src" "${_nya_files}"
  fi
  echo "Exported $(wc -l < "${_nya_patches}/series") patches and $(wc -l < "${tmp}/own.txt") files"
  rm -rf "${tmp}"
}

cmd_check() {
  require_tree
  ensure_vendor
  mkdir -p "${_vendor}/nya"
  g diff --name-only --no-renames --diff-filter=AM nya-base "$(patch_top)" |
    grep -E '\.(c|cc|cpp)$' > "${_vendor}/nya/objs.txt" || true
  clear_esbuild_link
  run_builder check.sh
}

finish_rebase() {
  [ ! -d "${_src}/.git/rebase-merge" ] && [ ! -d "${_src}/.git/rebase-apply" ] ||
    die "rebase still in progress; resolve, then: git -C ${_src} rebase --continue"
  [ "$(g branch --show-current)" = nya-old ] || die "not on the rebased branch nya-old"
  g branch -M nya-old master
  g tag -d nya-old-base > /dev/null
  cmd_export
  echo "Next: browser/scripts/patches.sh check, then browser/scripts/build.sh"
}

cmd_rebase() {
  require_tree
  if [ "${1:-}" = "--finish" ]; then
    finish_rebase
    return
  fi
  local old="${1:-}"
  [ -n "${old}" ] && [ -d "${old}/.git" ] || die "usage: patches.sh rebase OLD_SRC (an older tree set up by patches.sh)"
  old="$(cd "${old}" && pwd)"
  [ "$(g rev-parse HEAD)" = "$(g rev-parse nya-base)" ] || die "${_src} already has commits on top of nya-base"
  echo "Fetching ${old} (a few minutes)"
  g fetch -q --no-tags "${old}" "+refs/heads/master:refs/heads/nya-old" "+refs/tags/nya-base:refs/tags/nya-old-base"
  if [ "$(subject_of nya-old)" = nya/domsub ]; then
    g branch -f nya-old nya-old^
  fi
  echo "Rebasing $(g rev-list --count nya-old-base..nya-old) commits onto ${_tag}"
  if g rebase --onto nya-base nya-old-base nya-old; then
    finish_rebase
  else
    echo "Resolve the conflicts in ${_src}, then: git -C ${_src} rebase --continue" >&2
    echo "When the rebase is done: browser/scripts/patches.sh rebase --finish" >&2
    exit 1
  fi
}

case "${1:-}" in
  prep | init | apply | export | check | rebase)
    cmd="$1"
    shift
    "cmd_${cmd}" "$@"
    ;;
  *)
    sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
