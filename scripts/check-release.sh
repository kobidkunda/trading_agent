#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
failures=0

if ! bash "$root_dir/scripts/check-production-env.sh"; then
  failures=$((failures + 1))
fi

if ! SKIP_CURRENT_SECRET_SCAN=true bash "$root_dir/scripts/check-release-state.sh"; then
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  exit 1
fi

printf 'release checks passed\n'
