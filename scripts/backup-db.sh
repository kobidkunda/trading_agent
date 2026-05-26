#!/usr/bin/env bash
# Trusted PAPER Mode v1 — Database Backup
# Usage: bash scripts/backup-db.sh
# Creates timestamped backup + SQL dump in db/backups/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$ROOT_DIR/db/backups"

read_env_value() {
  local key="$1"
  local file value

  if [[ ${!key+x} ]]; then
    printf '%s\n' "${!key}"
    return 0
  fi

  for file in "$ROOT_DIR/.env.production" "$ROOT_DIR/.env"; do
    if [[ -f "$file" ]]; then
      value="$(
        awk -F= -v key="$key" '
          $0 !~ /^[[:space:]]*#/ && $1 == key {
            sub(/^[^=]*=/, "")
            print
            exit
          }
        ' "$file"
      )"
      if [[ -n "$value" ]]; then
        value="${value%$'\r'}"
        value="${value#\"}"
        value="${value%\"}"
        value="${value#\'}"
        value="${value%\'}"
        printf '%s\n' "$value"
        return 0
      fi
    fi
  done
}

DATABASE_URL="$(read_env_value DATABASE_URL || true)"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

case "$DATABASE_URL" in
  file:*)
    DB_FILE="${DATABASE_URL#file:}"
    ;;
  *)
    echo "ERROR: Unsupported DATABASE_URL for SQLite backup: $DATABASE_URL"
    exit 1
    ;;
esac

if [[ "$DB_FILE" != /* ]]; then
  DB_FILE="$ROOT_DIR/${DB_FILE#./}"
fi

if [ ! -f "$DB_FILE" ]; then
  echo "ERROR: Database file not found at $DB_FILE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_BACKUP="$BACKUP_DIR/custom-${TIMESTAMP}.db"
SQL_BACKUP="$BACKUP_DIR/dump-${TIMESTAMP}.sql"

echo "Backing up SQLite database..."
if command -v sqlite3 &> /dev/null; then
  sqlite3 "$DB_FILE" ".backup '$DB_BACKUP'"
else
  echo "WARNING: sqlite3 CLI not found, falling back to file copy"
  cp "$DB_FILE" "$DB_BACKUP"
fi
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
