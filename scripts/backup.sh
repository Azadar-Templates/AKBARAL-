#!/usr/bin/env sh
# AKBARAL! / MASTER AI — database backup (Milestone 10).
#
# DEPRECATED FORM: this script used to `cp` the live database file, which can
# produce a silently corrupt snapshot. It now delegates to the verified
# online backup tool (src/scripts/backup-db.ts): consistent VACUUM INTO
# snapshot + integrity check + row-count verification + retention.
#
# Usage: ./scripts/backup.sh [backupDir] [keep]
set -eu

BACKUP_DIR="${1:-backups}"
KEEP="${2:-30}"

exec npx tsx src/scripts/backup-db.ts "$BACKUP_DIR" "$KEEP"
