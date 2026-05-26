#!/usr/bin/env bash
set -euo pipefail

port="${PORT:-6502}"
host="${HOSTNAME:-127.0.0.1}"
base_url="http://${host}:${port}"
log_file="$(mktemp -t tcc-standalone-smoke.XXXXXX.log)"

cleanup() {
  if [[ -n "${server_pid:-}" ]] && kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$log_file"
}
trap cleanup EXIT

if [[ ! -f .next/standalone/server.js ]]; then
  printf 'standalone smoke failed: .next/standalone/server.js is missing; run npm run build first\n' >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -ti "tcp:${port}" >/dev/null 2>&1; then
  printf 'standalone smoke failed: port %s is already in use\n' "$port" >&2
  exit 1
fi

PORT="$port" NODE_ENV=production bun .next/standalone/server.js >"$log_file" 2>&1 &
server_pid="$!"

python3 - "$base_url" "$log_file" <<'PY'
import sys
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base_url = sys.argv[1]
log_path = Path(sys.argv[2])

deadline = time.time() + 15
last_error = None
while time.time() < deadline:
    try:
        with urlopen(Request(f"{base_url}/api"), timeout=2) as res:
            if res.status == 200:
                break
    except Exception as exc:  # noqa: BLE001 - smoke script reports last boot error
        last_error = exc
        time.sleep(0.25)
else:
    print(f"standalone smoke failed: server did not become ready: {last_error}", file=sys.stderr)
    print(log_path.read_text(errors="replace"), file=sys.stderr)
    sys.exit(1)

expected = {
    "/api": 200,
    "/api/reset": 401,
    "/api/dbtest": 401,
    "/api/test/sources": 401,
    "/api/test/quick-sources": 401,
}

for path, status in expected.items():
    try:
        with urlopen(Request(f"{base_url}{path}"), timeout=5) as res:
            actual = res.status
            body = res.read(240).decode("utf-8", "replace")
            headers = {key.lower(): value for key, value in res.headers.items()}
    except HTTPError as err:
        actual = err.code
        body = err.read(240).decode("utf-8", "replace")
        headers = {key.lower(): value for key, value in err.headers.items()}

    if actual != status:
        print(
            f"standalone smoke failed: {path} returned {actual}, expected {status}: {body}",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"{path} {actual}")

    if path == "/api":
        expected_headers = {
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
            "referrer-policy": "strict-origin-when-cross-origin",
            "cross-origin-opener-policy": "same-origin",
        }
        for key, expected_value in expected_headers.items():
            actual_value = headers.get(key)
            if actual_value != expected_value:
                print(
                    f"standalone smoke failed: {key}={actual_value!r}, expected {expected_value!r}",
                    file=sys.stderr,
                )
                sys.exit(1)

        permissions_policy = headers.get("permissions-policy", "")
        for directive in ["camera=()", "microphone=()", "geolocation=()", "payment=()"]:
            if directive not in permissions_policy:
                print(
                    f"standalone smoke failed: permissions-policy missing {directive}: {permissions_policy!r}",
                    file=sys.stderr,
                )
                sys.exit(1)

log_text = log_path.read_text(errors="replace")
required_logs = [
    "[Instrumentation] Pipeline worker auto-start disabled",
    "[Instrumentation] Paper loop auto-start disabled",
]
for line in required_logs:
    if line not in log_text:
        print(f"standalone smoke failed: missing boot log: {line}", file=sys.stderr)
        print(log_text, file=sys.stderr)
        sys.exit(1)

print("standalone smoke passed")
PY
