#!/bin/bash
# Compile only the objects of the sources listed in /repo/nya/objs.txt.
set -euo pipefail
. /repo/scripts/shared.sh
setup_paths
write_gn_args
fix_tool_downloading
setup_toolchain
cd "${_src_dir}"
[ -x out/Default/gn ] || ./tools/gn/bootstrap/bootstrap.py -o out/Default/gn --skip-generate-buildfiles
./out/Default/gn gen out/Default --fail-on-unused-args

built="$(mktemp)"
ninja -C out/Default -t compdb | grep -o '"file": "[^"]*"' | sed 's/^"file": "//; s/"$//' | sort -u > "${built}"
targets=()
while read -r f; do
  if grep -qxF "../../${f}" "${built}"; then
    targets+=("../../${f}^")
  else
    echo "skip (not built): ${f}"
  fi
done < /repo/nya/objs.txt
rm -f "${built}"
ninja -C out/Default -k 0 "${targets[@]}"
echo "check: ${#targets[@]} objects compiled"
