#!/bin/bash
# The in-tree edits portablelinux makes before building (domain substitution,
# then undoing it for the toolchain download scripts), run by patches.sh apply
# so they are committed and the tree stays clean after a build.
set -euo pipefail
. /repo/scripts/shared.sh
setup_paths
apply_domsub
fix_tool_downloading
