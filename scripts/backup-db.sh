#!/usr/bin/env bash
# Trusted PAPER Mode v1 — Database Backup
# Usage: bash scripts/backup-db.sh
# Creates timestamped backup + SQL dump in db/backups/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/db/backups"
DB_FILE="$ROOT_DIR/db/custom.db"

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: Database file not found at $DB_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_BACKUP="$BACKUP_DIR/custom-${TIMESTAMP}.db"
SQL_BACKUP="$BACKUP_DIR/dump-${TIMESTAMP}.sql"

echo "Backing up SQLite database..."
cp "$DB_FILE" "$DB_BACKUP"
ls -lh "$DB_BACKUP"

if command -v sqlite3 &> /dev/null; then
  echo "Creating SQL dump..."
  sqlite3 "$DB_FILE" .dump > "$SQL_BACKUP"
  ls -lh "$SQL_BACKUP"
else
  echo "WARNING: sqlite3 CLI not found, skipping SQL dump"
fi

# Keep only last 7 daily backups
ls -1t "$BACKUP_DIR"/custom-*.db 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/dump-*.sql 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "Backup complete: $DB_BACKUP"
