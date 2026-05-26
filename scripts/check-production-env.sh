#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

failures=0

fail() {
  printf 'production check failed: %s\n' "$1" >&2
  failures=$((failures + 1))
}

read_env_value() {
  local key="$1"
  local file value

  if [[ ${!key+x} ]]; then
    printf '%s\n' "${!key}"
    return 0
  fi

  for file in "$root_dir/.env.production" "$root_dir/.env"; do
    if [[ -f "$file" ]]; then
      value="$(awk -F= -v key="$key" '
        $0 !~ /^[[:space:]]*#/ && $1 == key {
          sub(/^[^=]*=/, "")
          print
          exit
        }
      ' "$file")"
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

require_not_true() {
  local key="$1"
  local value
  value="$(read_env_value "$key" | tr '[:upper:]' '[:lower:]' || true)"
  if [[ "$value" == "true" ]]; then
    fail "$key must not be true for production deploys"
  fi
}

require_set() {
  local key="$1"
  local value
  value="$(read_env_value "$key" || true)"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    fail "$key must be set for production deploys"
  fi
}

require_secret_value() {
  local key="$1"
  local min_length="$2"
  local value
  value="$(read_env_value "$key" || true)"
  local trimmed="${value//[[:space:]]/}"
  local lowered
  lowered="$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]')"

  if [[ -z "$trimmed" ]]; then
    fail "$key must be set for production deploys"
    return
  fi

  if ((${#trimmed} < min_length)); then
    fail "$key must be at least $min_length characters"
  fi

  if [[ "$lowered" == *placeholder* || "$lowered" == *change-it* || "$lowered" == *changeme* || "$lowered" == *example* || "$lowered" == *not-for-production* ]]; then
    fail "$key must not use a placeholder value"
  fi
}

require_not_true LOCAL_DEV_AUTH_BYPASS
require_not_true ENABLE_RESET_API
require_not_true ENABLE_DBTEST_API
require_not_true ENABLE_TEST_API
require_not_true ALLOW_ANY_TARGET
require_set DATABASE_URL
require_secret_value SEARXNG_SECRET_KEY 32

floating_images_file="$tmp_dir/floating-images.txt"
if grep -RInE '(^[[:space:]]*image:[[:space:]].*:latest[[:space:]]*$|^FROM[[:space:]]+python:[^@[:space:]]+[[:space:]]*$)' \
  "$root_dir/docker-compose.yml" \
  "$root_dir/Dockerfile.agent-reach" \
  "$root_dir/ta-service/Dockerfile" >"$floating_images_file" 2>/dev/null; then
  fail "deployment images must be pinned by digest: $(tr '\n' ' ' <"$floating_images_file")"
fi

if command -v docker >/dev/null 2>&1; then
  compose_err_file="$tmp_dir/compose-check.err"
  compose_config="$(cd "$root_dir" && docker compose config 2>"$compose_err_file" || true)"
  if [[ -z "$compose_config" ]]; then
    fail "docker compose config failed: $(tr '\n' ' ' <"$compose_err_file")"
  elif grep -q 'change-it-to-a-random-string' <<<"$compose_config"; then
    fail "docker compose config contains the default SearXNG secret placeholder"
  fi

  compose_json_err_file="$tmp_dir/compose-check-json.err"
  compose_config_json="$(cd "$root_dir" && docker compose config --format json 2>"$compose_json_err_file" || true)"
  if [[ -z "$compose_config_json" ]]; then
    fail "docker compose config --format json failed: $(tr '\n' ' ' <"$compose_json_err_file")"
  elif ! python3 - "$compose_config_json" <<'PY'
import sys
import json

config = json.loads(sys.argv[1])
sidecars = {
    "searxng": {"8080"},
    "tradingagents": {"8100"},
    "agent-reach": {"6656"},
}

bad = []
for service_name, targets in sidecars.items():
    service = (config.get("services") or {}).get(service_name) or {}
    for port in service.get("ports") or []:
        target = str(port.get("target", ""))
        host_ip = str(port.get("host_ip", ""))
        if target in targets and host_ip not in {"127.0.0.1", "::1"}:
            published = port.get("published", "")
            bad.append(f"{service_name}:{published}->{target} host_ip={host_ip or '<all>'}")

if bad:
    print("\n".join(bad), file=sys.stderr)
    sys.exit(1)
PY
  then
    fail "docker compose sidecar ports must bind to loopback only"
  fi
fi

if command -v git >/dev/null 2>&1 && git -C "$root_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  secret_files="$(
    git -C "$root_dir" grep -Il -E 'sk-[A-Za-z0-9_-]{12,}|BEGIN (RSA|OPENSSH|PRIVATE) KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]{20,}' HEAD 2>/dev/null |
      sed 's#^HEAD:##' || true
  )"
  if [[ -n "$secret_files" ]]; then
    fail "tracked files contain secret-looking tokens: $(tr '\n' ' ' <<<"$secret_files")"
  fi
fi

if (( failures > 0 )); then
  exit 1
fi

printf 'production environment checks passed\n'
