#!/bin/bash
# scripts/commit.sh — Git add, commit, and push for an agent repo.
# Usage: commit.sh [agent-dir] [message]
#
# Push target comes from agent.yaml:
#   git-remote:    full https (or file/ssh) URL of the agent's repo, without
#                  credentials. Default: https://github.com/<repo>.git
#   git-token-env: name of the env var holding the token for that remote.
#                  Default: GH_TOKEN
# The token is inserted into an https URL as `https://<token>@host/...`, the
# form GitHub and Azure DevOps both accept. Non-https remotes are pushed as-is.
#
# A failed push never fails the cycle — the work is done and the commit is kept
# locally, so the next successful push carries it. But it is logged as an
# `error` event, because a remote that silently stops receiving pushes looks
# exactly like one that works.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:-$(pwd)}"
MSG="${2:-agent state update}"

cd "$AGENT_DIR"

# Source sandcat profile scripts if available (cron doesn't inherit container env)
for _f in /etc/profile.d/sandcat-*.sh; do
  [ -r "$_f" ] && . "$_f"
done

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"

TOKEN_ENV="${AGENT_GIT_TOKEN_ENV:-GH_TOKEN}"

# Source .env if the push token still is not set (pre-Sandcat fallback)
if [[ "$TOKEN_ENV" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && [ -z "${!TOKEN_ENV:-}" ] \
   && [ -f "$AGENT_DIR/.env" ]; then
  . "$FRAMEWORK_DIR/scripts/load-env.sh"; load_agent_env "$AGENT_DIR/.env"
fi

TIMESTAMP="$(date -Iseconds)"

git add -A .

if git diff --cached --quiet; then
  echo "Nothing to commit."
  exit 0
fi

git commit -m "${TIMESTAMP} — ${MSG}"

push_failed() {
  echo "Warning: git push failed — $1" >&2
  bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" error \
    "git push to ${REMOTE:-<no remote>} failed: $1" 2>/dev/null || true
  exit 0
}

if ! [[ "$TOKEN_ENV" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  REMOTE="${AGENT_GIT_REMOTE:-}"
  push_failed "git-token-env '$TOKEN_ENV' is not a valid variable name"
fi
TOKEN="${!TOKEN_ENV:-}"

if [ -n "${AGENT_GIT_REMOTE:-}" ]; then
  REMOTE="$AGENT_GIT_REMOTE"
elif [ -n "${AGENT_REPO:-}" ]; then
  REMOTE="https://github.com/${AGENT_REPO}.git"
  # Unchanged default behaviour: no token means an offline agent (or a test),
  # not a misconfiguration, so it stays a plain warning.
  if [ -z "$TOKEN" ]; then
    echo "Warning: $TOKEN_ENV not set, skipping push"
    exit 0
  fi
else
  push_failed "agent.yaml sets neither git-remote nor repo"
fi

case "$REMOTE" in
  https://*)
    [ -n "$TOKEN" ] || push_failed "$TOKEN_ENV is not set"
    REST="${REMOTE#https://}"
    # Drop any username already in the URL (Azure DevOps "clone" URLs carry the org).
    HOSTPART="${REST%%/*}"
    [[ "$HOSTPART" == *@* ]] && REST="${REST#*@}"
    PUSH_URL="https://${TOKEN}@${REST}"
    ;;
  *)
    PUSH_URL="$REMOTE"
    ;;
esac

set +e
OUT="$(git push "$PUSH_URL" main 2>&1)"
RC=$?
set -e
# Never echo or log the token, whatever git puts in its output.
[ -n "$TOKEN" ] && OUT="${OUT//$TOKEN/***}"
[ -n "$OUT" ] && echo "$OUT"

if [ "$RC" -ne 0 ]; then
  WHY="$(printf '%s\n' "$OUT" | grep -m1 -E 'fatal|error|rejected|denied' || true)"
  [ -n "$WHY" ] || WHY="$(printf '%s\n' "$OUT" | tail -n 1)"
  push_failed "$(printf '%s' "${WHY:-exit $RC}" | cut -c1-200)"
fi
