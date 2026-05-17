#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENVIRONMENT="${APP_ENV:-development}"

if [[ "${DB_BACKUP_BEFORE_MIGRATION:-true}" != "true" ]]; then
  echo "Refusing schema push: DB_BACKUP_BEFORE_MIGRATION must be true"
  exit 1
fi

echo "Creating backup before schema push..."
bash "$SCRIPT_DIR/backup-db.sh"

if [[ "$ENVIRONMENT" == "production" && "${ALLOW_ACCEPT_DATA_LOSS:-false}" == "true" ]]; then
  echo "Refusing unsafe production push: ALLOW_ACCEPT_DATA_LOSS cannot be true in production"
  exit 1
fi

if [[ "$ENVIRONMENT" == "production" ]]; then
  echo "Running prisma db push without accept-data-loss (production mode)"
  npx prisma db push
else
  echo "Running prisma db push in non-production mode"
  npx prisma db push "$@"
fi
