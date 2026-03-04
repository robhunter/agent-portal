#!/bin/bash
# scripts/commit.sh — Git add, commit, and push for an agent repo.
# Usage: commit.sh [agent-dir] [message]
# Reads agent.yaml for repo name. Expects GH_TOKEN in environment or agent's .env.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:-$(pwd)}"
MSG="${2:-agent state update}"

cd "$AGENT_DIR"

# Source .env if GH_TOKEN not already set (cron doesn't inherit Docker env vars)
if [ -z "$GH_TOKEN" ] && [ -f "$AGENT_DIR/.env" ]; then
  set -a; . "$AGENT_DIR/.env"; set +a
fi

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"

TIMESTAMP="$(date -Iseconds)"

git add -A .

if git diff --cached --quiet; then
  echo "Nothing to commit."
  exit 0
fi

git commit -m "${TIMESTAMP} — ${MSG}"

# Push using repo from agent.yaml
if [ -n "$GH_TOKEN" ]; then
  git push "https://${GH_TOKEN}@github.com/${AGENT_REPO}.git" main 2>&1 || echo "Warning: git push failed"
else
  echo "Warning: GH_TOKEN not set, skipping push"
fi
