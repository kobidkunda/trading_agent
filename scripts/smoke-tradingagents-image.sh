#!/usr/bin/env bash
set -euo pipefail

image="${TRADINGAGENTS_IMAGE:-tb-tradingagents:latest}"
container_name="${TRADINGAGENTS_SMOKE_CONTAINER:-tcc-ta-health-smoke}"
port="${TRADINGAGENTS_SMOKE_PORT:-6513}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker run --rm -d --name "$container_name" -p "${port}:8100" "$image" >/dev/null

python3 - "$port" <<'PY'
import json
import sys
import time
from urllib.request import urlopen

port = sys.argv[1]
last_error = None
for _ in range(40):
    try:
        with urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as res:
            body = res.read().decode("utf-8", "replace")
            payload = json.loads(body)
            assert res.status == 200, (res.status, payload)
            assert payload.get("status") == "healthy", payload
            assert payload.get("service") == "tradingagents-api", payload
            print(
                "tradingagents image health passed: "
                f"{payload.get('service')} v{payload.get('version')}"
            )
            sys.exit(0)
    except Exception as exc:  # noqa: BLE001 - smoke script reports last boot error
        last_error = exc
        time.sleep(0.5)

print(f"tradingagents image health failed: {last_error}", file=sys.stderr)
sys.exit(1)
PY
