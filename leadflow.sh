#!/usr/bin/env sh
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ ! -f "$DIR/release/leadflow.cjs" ]; then
  echo "Gerando launcher..."
  (cd "$DIR" && npm run launcher:build)
fi
exec node "$DIR/release/leadflow.cjs" "$@"
