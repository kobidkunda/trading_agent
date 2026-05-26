#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root_dir"

npm run check:release
npm run check:db-backup
bun audit --audit-level high
npm run typecheck
npm run lint
npm run test
npm run test:tradingagents

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
python_bin="${PYTHON_AUDIT_BIN:-}"
if [[ -z "$python_bin" ]]; then
  if command -v python3.13 >/dev/null 2>&1; then
    python_bin="python3.13"
  else
    python_bin="python3.11"
  fi
fi

"$python_bin" -m venv "$tmp_dir/venv"
pip_audit_install_log="$tmp_dir/pip-audit-install.log"
"$tmp_dir/venv/bin/python" -m pip install --upgrade pip >"$pip_audit_install_log" 2>&1
"$tmp_dir/venv/bin/python" -m pip install pip-audit >>"$pip_audit_install_log" 2>&1
"$tmp_dir/venv/bin/pip-audit" -r ta-service/requirements.txt

npm run build
bash scripts/smoke-standalone.sh

if [[ "${SKIP_COMPOSE_BUILD:-false}" != "true" ]]; then
  if command -v docker >/dev/null 2>&1; then
    docker compose build agent-reach tradingagents
    bash scripts/smoke-tradingagents-image.sh
  else
    printf 'predeploy check skipped compose image build because docker is not installed; set SKIP_COMPOSE_BUILD=true to make this explicit\n' >&2
    exit 1
  fi
fi

printf 'predeploy checks passed\n'
