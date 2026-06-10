#!/usr/bin/env bash
# Run the acceptance matrix (harness/check.mjs) against the local tree.
# check.mjs serves the repo root itself — no separate dev server needed.
set -euo pipefail
cd "$(dirname "$0")"
for nodedir in ../.tools/node-v20.18.1-linux-x64/bin /tmp/vilna-daf-tools/node-v20.18.1-linux-x64/bin; do
  if [ -d "$nodedir" ]; then
    export PATH="$(cd "$nodedir" && pwd):$PATH"
    break
  fi
done
[ -d node_modules ] || npm install
node check.mjs "$@"
