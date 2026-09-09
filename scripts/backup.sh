#!/usr/bin/env sh
set -eu

DB_FILE="${1:-data/akbaral.db}"
BACKUP_DIR="${2:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp "$DB_FILE" "$BACKUP_DIR/akbaral-${STAMP}.db"
echo "[akbaral] database backed up to $BACKUP_DIR/akbaral-${STAMP}.db"
