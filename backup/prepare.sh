#!/bin/sh
set -euo pipefail

BASE_DIR="${1:-}"
if [ -z "$BASE_DIR" ]; then
  echo "uso: prepare.sh /backups/full-YYYYmmdd-HHMMSS" >&2
  exit 1
fi

xtrabackup --prepare --apply-log-only --target-dir="$BASE_DIR"

for INC in $(ls -d /backups/inc-* 2>/dev/null | sort); do
  xtrabackup --prepare --apply-log-only --target-dir="$BASE_DIR" --incremental-dir="$INC"
done

xtrabackup --prepare --target-dir="$BASE_DIR"
echo "[prepare] Concluído para $BASE_DIR"
