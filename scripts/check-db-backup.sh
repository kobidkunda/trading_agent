#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
backup_dir="${DB_BACKUP_DIR:-$root_dir/db/backups}"
max_age_seconds="${DB_BACKUP_MAX_AGE_SECONDS:-86400}"

read_env_value() {
  local key="$1"
  local file value

  if [[ ${!key+x} ]]; then
    printf '%s\n' "${!key}"
    return 0
  fi

  for file in "$root_dir/.env.production" "$root_dir/.env"; do
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

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'database backup check failed: DATABASE_URL is not set\n' >&2
  exit 1
fi

case "$DATABASE_URL" in
  file:*)
    db_file="${DATABASE_URL#file:}"
    ;;
  *)
    printf 'database backup check failed: unsupported DATABASE_URL for SQLite backup: %s\n' "$DATABASE_URL" >&2
    exit 1
    ;;
esac

if [[ "$db_file" != /* ]]; then
  db_file="$root_dir/${db_file#./}"
fi

if [[ ! -f "$db_file" ]]; then
  printf 'database backup check failed: database file not found at %s\n' "$db_file" >&2
  exit 1
fi

if [[ ! -d "$backup_dir" ]]; then
  printf 'database backup check failed: backup directory not found at %s\n' "$backup_dir" >&2
  exit 1
fi

latest_backup="$(find "$backup_dir" -maxdepth 1 -type f -name 'custom-*.db' -print0 | xargs -0 ls -1t 2>/dev/null | head -n 1 || true)"
if [[ -z "$latest_backup" ]]; then
  printf 'database backup check failed: no custom-*.db backups found in %s\n' "$backup_dir" >&2
  exit 1
fi

if [[ ! -s "$latest_backup" ]]; then
  printf 'database backup check failed: latest backup is empty: %s\n' "$latest_backup" >&2
  exit 1
fi

if command -v sqlite3 >/dev/null 2>&1; then
  integrity_result="$(sqlite3 "$latest_backup" 'PRAGMA quick_check;' 2>/tmp/tcc-db-backup-integrity.err || true)"
  if [[ "$integrity_result" != "ok" ]]; then
    printf 'database backup check failed: latest backup failed SQLite quick_check: %s\n' "$latest_backup" >&2
    tr '\n' ' ' </tmp/tcc-db-backup-integrity.err >&2
    printf '\n' >&2
    exit 1
  fi
fi

now="$(date +%s)"
backup_mtime="$(stat -f %m "$latest_backup" 2>/dev/null || stat -c %Y "$latest_backup")"
db_mtime="$(stat -f %m "$db_file" 2>/dev/null || stat -c %Y "$db_file")"
age_seconds=$((now - backup_mtime))

if (( age_seconds > max_age_seconds )); then
  printf 'database backup check failed: latest backup is %ss old, max allowed is %ss: %s\n' "$age_seconds" "$max_age_seconds" "$latest_backup" >&2
  exit 1
fi

if (( backup_mtime < db_mtime )); then
  printf 'database backup check failed: latest backup predates database file; run bash scripts/backup-db.sh before deploy\n' >&2
  printf 'database: %s\nbackup:   %s\n' "$db_file" "$latest_backup" >&2
  exit 1
fi

printf 'database backup check passed: %s\n' "$latest_backup"
