#!/usr/bin/env bash
set -Eeuo pipefail

PROD_SSH_USER="${PROD_SSH_USER:-biolastic}"
PROD_SSH_HOST="${PROD_SSH_HOST:-192.168.88.110}"
PROD_APP_DIR="${PROD_APP_DIR:-/www/wwwroot/ta/trading_agent}"
PROD_PM2_APP="${PROD_PM2_APP:-all}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
  printf '\n[ERROR] %s\n' "$*" >&2
  exit 1
}

on_error() {
  local exit_code="$1"
  local line_no="$2"
  local cmd="$3"
  printf '\n[ERROR] step failed at line %s (exit=%s): %s\n' "$line_no" "$exit_code" "$cmd" >&2
  exit "$exit_code"
}
trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

run_step() {
  local title="$1"
  shift
  log "$title"
  "$@"
}

run_remote() {
  local remote_cmd="$1"

  if [[ -n "${PROD_SSH_PASSWORD:-}" ]]; then
    command -v sshpass >/dev/null 2>&1 || die "sshpass required when PROD_SSH_PASSWORD is set"
    sshpass -p "$PROD_SSH_PASSWORD" ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${HOME}/.ssh/known_hosts" "${PROD_SSH_USER}@${PROD_SSH_HOST}" "$remote_cmd"
  else
    ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${HOME}/.ssh/known_hosts" "${PROD_SSH_USER}@${PROD_SSH_HOST}" "$remote_cmd"
  fi
}

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: bash scripts/deploy-prod.sh

Optional env:
  PROD_SSH_USER      (default: biolastic)
  PROD_SSH_HOST      (default: 192.168.88.110)
  PROD_APP_DIR       (default: /www/wwwroot/ta/trading_agent)
  PROD_PM2_APP       (default: all)
  PROD_SSH_PASSWORD  (optional, if no SSH key; requires sshpass)
EOF
  exit 0
fi

run_step "Go to repo root" cd "$ROOT_DIR"
run_step "Show git branch" git status --short --branch
run_step "Stage changes" git add -A

if git diff --cached --quiet; then
  log "No staged changes to commit"
else
  run_step "Commit changes" git commit -m "chore: production deploy sync"
fi

run_step "Push current branch" git push

REMOTE_SCRIPT=$(cat <<EOF
set -Eeuo pipefail
cd "$PROD_APP_DIR"

echo "[remote] branch: \\$(git rev-parse --abbrev-ref HEAD)"
git pull --ff-only

LOCK_HASH_FILE=".deploy.lock.hash"
LOCK_HASH_NOW=""
if [[ -f package-lock.json ]]; then
  LOCK_HASH_NOW=\\$(sha256sum package-lock.json | awk '{print \\$1}')
elif [[ -f bun.lockb ]]; then
  LOCK_HASH_NOW=\\$(sha256sum bun.lockb | awk '{print \\$1}')
fi

LOCK_HASH_PREV=""
if [[ -f "\\$LOCK_HASH_FILE" ]]; then
  LOCK_HASH_PREV=\\$(cat "\\$LOCK_HASH_FILE")
fi

if [[ -n "\\$LOCK_HASH_NOW" && "\\$LOCK_HASH_NOW" != "\\$LOCK_HASH_PREV" ]]; then
  echo "[remote] lockfile changed -> install deps"
  if command -v bun >/dev/null 2>&1; then
    bun install --frozen-lockfile || bun install
  elif command -v npm >/dev/null 2>&1; then
    npm ci || npm install
  else
    echo "[remote][ERROR] neither bun nor npm found"
    exit 127
  fi
  echo "\\$LOCK_HASH_NOW" > "\\$LOCK_HASH_FILE"
else
  echo "[remote] lockfile unchanged -> skip install"
fi

export APP_ENV=production
bash scripts/safe-db-push.sh

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PROD_PM2_APP"
  pm2 status
  pm2 logs --lines 50 --nostream
else
  echo "[remote][ERROR] pm2 not found"
  exit 127
fi
EOF
)

run_step "Deploy on production host" run_remote "$REMOTE_SCRIPT"

log "Deploy complete"
