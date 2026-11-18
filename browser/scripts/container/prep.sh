#!/bin/bash
# Unpack, prune and patch (ungoogled + portablelinux) the sources. No Nya
# patches and no domain substitution: this is the tree patches.sh tracks.
set -euo pipefail
. /repo/scripts/shared.sh
setup_paths
fetch_sources false false
apply_patches
