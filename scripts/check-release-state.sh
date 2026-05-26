#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
failures=0

fail() {
  printf 'release check failed: %s\n' "$1" >&2
  failures=$((failures + 1))
}

if ! git -C "$root_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  fail "not inside a git worktree"
else
  if [[ -n "$(git -C "$root_dir" status --porcelain=v1)" ]]; then
    fail "worktree has uncommitted changes; deploy only from a clean reviewed commit"
  fi

  upstream="$(git -C "$root_dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [[ -z "$upstream" ]]; then
    fail "current branch has no upstream; deploy branches must track a remote"
  else
    read -r ahead behind < <(git -C "$root_dir" rev-list --left-right --count "HEAD...$upstream")
    if [[ "$ahead" != "0" || "$behind" != "0" ]]; then
      fail "branch diverges from $upstream (ahead=$ahead behind=$behind); reconcile before deploy"
    fi
  fi

  if [[ "${SKIP_CURRENT_SECRET_SCAN:-false}" != "true" ]]; then
    current_secret_files="$(
      git -C "$root_dir" grep -Il -E 'sk-[A-Za-z0-9_-]{12,}|BEGIN (RSA|OPENSSH|PRIVATE) KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]{20,}' HEAD 2>/dev/null |
        sed 's#^HEAD:##' || true
    )"
    if [[ -n "$current_secret_files" ]]; then
      fail "tracked files contain secret-looking tokens: $(tr '\n' ' ' <<<"$current_secret_files")"
    fi
  fi

  history_secret_hits="$(
    git -C "$root_dir" log --all --format='%H' |
      while read -r commit; do
        (git -C "$root_dir" grep -Il -E 'sk-[A-Za-z0-9_-]{12,}|BEGIN (RSA|OPENSSH|PRIVATE) KEY|xox[baprs]-|gh[pousr]_[A-Za-z0-9_]{20,}' "$commit" 2>/dev/null || true) |
          sed "s#^#$commit #"
      done |
      sed -n '1,20p'
  )"
  if [[ -n "$history_secret_hits" && "${ALLOW_ROTATED_SECRET_HISTORY:-false}" != "true" ]]; then
    fail "secret-looking tokens exist in git history; rotate exposed credentials, then rerun with ALLOW_ROTATED_SECRET_HISTORY=true and ROTATED_SECRET_HISTORY_AT=<ISO-8601 timestamp> if history rewrite is intentionally deferred"
    printf '%s\n' "$history_secret_hits" >&2
  elif [[ -n "$history_secret_hits" ]]; then
    if [[ -z "${ROTATED_SECRET_HISTORY_AT:-}" ]]; then
      fail "ALLOW_ROTATED_SECRET_HISTORY requires ROTATED_SECRET_HISTORY_AT=<ISO-8601 timestamp> documenting when exposed credentials were rotated"
    elif ! [[ "$ROTATED_SECRET_HISTORY_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
      fail "ROTATED_SECRET_HISTORY_AT must be UTC ISO-8601 format like 2026-05-26T00:00:00Z"
    fi
    printf '%s\n' "$history_secret_hits" >&2
  fi
fi

if (( failures > 0 )); then
  exit 1
fi

printf 'release state checks passed\n'
