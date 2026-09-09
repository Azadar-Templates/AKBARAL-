#!/usr/bin/env sh
# AKBARAL! / MASTER AI — container entrypoint (Milestone 10).
set -eu

echo "[akbaral] applying database migrations"
node dist/src/db/migrate.js

if [ "${SEED_DATABASE:-false}" = "true" ]; then
  echo "[akbaral] seeding registry + plans"
  node dist/src/db/seed.js
fi

# Nightly verified database backup inside the volume (01:17 UTC, after the
# daily traffic trough starts; verified snapshot + retention, see
# src/scripts/backup-db.ts). Disable with DISABLE_BACKUP_CRON=1 when the
# host or an external scheduler owns backups.
if [ "${DISABLE_BACKUP_CRON:-false}" != "true" ]; then
  (
    while true; do
      # Seconds until the next 01:17 UTC.
      NOW_S=$(( ( (10#$(date -u +%H) * 60) + 10#$(date -u +%M) ) * 60 + 10#$(date -u +%S) ))
      TARGET_S=$(( (1 * 3600) + (17 * 60) ))
      if [ "$NOW_S" -ge "$TARGET_S" ]; then
        WAIT_S=$(( 86400 - NOW_S + TARGET_S ))
      else
        WAIT_S=$(( TARGET_S - NOW_S ))
      fi
      sleep "$WAIT_S"
      echo "[akbaral] scheduled backup starting"
      node dist/src/scripts/backup-db.js /data/backups "${BACKUP_KEEP:-30}" \
        && echo "[akbaral] scheduled backup OK" \
        || echo "[akbaral] scheduled backup FAILED (exit $?)"
    done
  ) &
fi

echo "[akbaral] starting production stack (API :4000, web :3000)"
exec node scripts/start-prod.mjs
