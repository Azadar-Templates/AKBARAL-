#!/usr/bin/env sh
# AKBARAL! / MASTER AI — container entrypoint (Milestone 10; StackHost
# startup fix, 2026-09-17).
#
# `set -e` used to mean that ANY early step failing (a partial build, a
# missing dependency, migrations run before the build even produced
# dist/src/db/migrate.js) killed the shell immediately — and because that
# happened 2-3 seconds after the container started, before Node had printed
# a single line, the platform saw a silent exit with no application logs.
#
# The corrected contract:
#   - migrations, the optional seed step and the build preflight all live in
#     scripts/start-prod.mjs now, so there is exactly one place that decides
#     "are we ready to start" and it always prints WHY before it gives up.
#   - this script's only two jobs are (1) the nightly backup scheduler loop,
#     which is genuinely optional and must never abort startup, and (2)
#     `exec`-ing the startup wrapper as the FINAL statement, so the wrapper
#     replaces this shell (correct signal handling) and its exit code is the
#     container's exit code — it can never "silently exit" underneath it.
set -eu

# Nightly verified database backup inside the volume (01:17 UTC, after the
# daily traffic trough starts; verified snapshot + retention, see
# src/scripts/backup-db.ts). Disable with DISABLE_BACKUP_CRON=1 when the
# host or an external scheduler owns backups. This loop is intentionally
# backgrounded and never allowed to fail the container: a backup-cron bug
# must not take production down.
if [ "${DISABLE_BACKUP_CRON:-false}" != "true" ]; then
  (
    while true; do
      # Seconds since midnight UTC. POSIX arithmetic only: epoch % 86400
      # avoids the leading-zero octal trap (08/09) that broke the bash-only
      # `10#HH` form under /bin/sh (dash) on node:22-slim.
      NOW_S=$(( $(date -u +%s) % 86400 ))
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

echo "[akbaral] starting production stack (scripts/start-prod.mjs applies migrations,"
echo "[akbaral] verifies build artifacts, then starts the API + web tiers; the"
echo "[akbaral] next logs come from that wrapper)"
# `exec` replaces this shell with the Node process: the startup wrapper is the
# real PID 1 payload, so a crash there is a container exit with a real log
# trail — not a shell falling off the end silently.
exec node scripts/start-prod.mjs
