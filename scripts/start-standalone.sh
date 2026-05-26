#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${PORT:-6501}"
START_RUNTIME="${START_RUNTIME:-node}"

cd "$APP_DIR"

echo "Running production startup checks..."
npm run check:release
npm run check:db-backup

if [[ ! -f .next/standalone/server.js ]]; then
  echo "Production build is missing .next/standalone/server.js; run npm run build before starting." >&2
  exit 1
fi

if [[ ! -d .next/static ]]; then
  echo "Production build is missing .next/static; run npm run build before starting." >&2
  exit 1
fi

if [[ ! -d public ]]; then
  echo "Production build is missing public assets directory." >&2
  exit 1
fi

if ! command -v "$START_RUNTIME" >/dev/null 2>&1; then
  echo "Production runtime is unavailable: $START_RUNTIME" >&2
  exit 1
fi

mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static .next/standalone/public
cp -R .next/static .next/standalone/.next/static
cp -R public .next/standalone/public

cd .next/standalone
exec env NODE_ENV=production PORT="$PORT" "$START_RUNTIME" server.js
