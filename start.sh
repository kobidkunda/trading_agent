#!/usr/bin/env bash
# Trading Command Center - Production Server Startup
# Auto-restarts on crash

set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
PORT="${PORT:-6501}"
LOG_FILE="${LOG_FILE:-/tmp/tcc_server.log}"

cd "$APP_DIR"

echo "Running production startup checks..."
npm run check:release
npm run check:db-backup

if [[ ! -f .next/standalone/server.js ]]; then
  echo "Production build is missing .next/standalone/server.js; run npm run build before starting." >&2
  exit 1
fi

# Copy static assets to standalone (required for standalone builds)
if [[ ! -d .next/static ]]; then
  echo "Production build is missing .next/static; run npm run build before starting." >&2
  exit 1
fi

if [[ ! -d public ]]; then
  echo "Production build is missing public assets directory." >&2
  exit 1
fi

mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static .next/standalone/public
cp -R .next/static .next/standalone/.next/static
cp -R public .next/standalone/public

# Stop any existing server on the configured port only after checks pass.
if command -v lsof >/dev/null 2>&1; then
  existing_pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null | sort -u || true)"
  if [[ -n "$existing_pids" ]]; then
    echo "Stopping existing process(es) on port $PORT..."
    while IFS= read -r pid; do
      [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done <<<"$existing_pids"
    sleep 1
  fi
else
  echo "lsof is unavailable; skipping pre-start port cleanup." >&2
fi

echo "Starting Trading Command Center..."

# Start server with auto-restart loop
(
  while true; do
    cd "$APP_DIR/.next/standalone"
    NODE_ENV=production PORT="$PORT" node server.js >> "$LOG_FILE" 2>&1
    echo "[$(date)] Server exited, restarting in 2s..." >> "$LOG_FILE"
    sleep 2
  done
) &

SERVER_PID=$!

echo "Watchdog PID: $SERVER_PID"

if python3 - "$PORT" "$LOG_FILE" <<'PY'
import sys
import time
from pathlib import Path
from urllib.request import Request, urlopen

port = sys.argv[1]
log_path = Path(sys.argv[2])
url = f"http://127.0.0.1:{port}/api"
deadline = time.time() + 20
last_error = None

while time.time() < deadline:
    try:
        with urlopen(Request(url), timeout=2) as res:
            if res.status == 200:
                print(f"Trading Command Center is RUNNING on http://localhost:{port}")
                sys.exit(0)
            last_error = f"unexpected status {res.status}"
    except Exception as exc:  # noqa: BLE001 - startup script reports the last readiness error
        last_error = exc
    time.sleep(0.5)

print(f"Failed to start - {url} did not return 200: {last_error}", file=sys.stderr)
if log_path.exists():
    print(log_path.read_text(errors="replace")[-4000:], file=sys.stderr)
else:
    print(f"Log file was not created: {log_path}", file=sys.stderr)
sys.exit(1)
PY
then
  disown "$SERVER_PID" 2>/dev/null || true
else
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait "$SERVER_PID" >/dev/null 2>&1 || true
  exit 1
fi
