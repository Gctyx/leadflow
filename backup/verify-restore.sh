#!/bin/sh
set -euo pipefail

BASE="$(ls -dt /backups/full-* 2>/dev/null | head -n1 || true)"
if [ -z "$BASE" ]; then
  echo "[verify] Nenhum full backup encontrado" >&2
  exit 1
fi

/backup/prepare.sh "$BASE"
echo "[verify] OK: prepare aplicado para $BASE"
