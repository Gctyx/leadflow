#!/bin/sh
set -euo pipefail

MODE="${1:-full}"
TS="$(date +%Y%m%d-%H%M%S)"
PAR="--parallel=${BACKUP_CONCURRENCY:-2}"

mkdir -p /backups

if [ "$MODE" = "full" ]; then
  TARGET="/backups/full-$TS"
  xtrabackup --backup --datadir=/var/lib/mysql --target-dir="$TARGET" $PAR
else
  LAST_BASE="$(ls -dt /backups/full-* /backups/inc-* 2>/dev/null | head -n1 || true)"
  if [ -z "$LAST_BASE" ]; then
    echo "[backup] Nenhuma base para incremental; faça um full primeiro" >&2
    exit 1
  fi
  TARGET="/backups/inc-$TS"
  xtrabackup --backup --datadir=/var/lib/mysql --target-dir="$TARGET" --incremental-basedir="$LAST_BASE" $PAR
fi

# Retenção simples
ls -dt /backups/full-* 2>/dev/null | awk "NR>${BACKUP_RETENTION_FULL:-7}" | xargs -r rm -rf || true
ls -dt /backups/inc-* 2>/dev/null | awk "NR>${BACKUP_RETENTION_INC:-48}" | xargs -r rm -rf || true

echo "[backup] Concluído em $TARGET"
