#!/bin/bash
# portablelinux scripts/build.sh for a tree prepared by patches.sh apply. Keeps
# out/ (incremental build) unless --clean is given.
set -euo pipefail
. /repo/scripts/shared.sh
setup_paths
if [ "${1:-}" = "--clean" ]; then
  rm -rf "${_src_dir}/out"
fi
write_gn_args
fix_tool_downloading
setup_toolchain
gn_gen
maybe_build
