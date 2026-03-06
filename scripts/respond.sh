#!/bin/bash
# scripts/respond.sh — Lightweight journal-respond cycle.
# Usage: respond.sh [agent-dir]
# Non-Telegram interaction model: Rob writes to the journal via the portal,
# agent reads and responds on the next respond cycle.
# Reads respond-prompt from agent.yaml.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:-$(pwd)}"
cd "$AGENT_DIR"

# Source nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Source .env
if [ -f "$AGENT_DIR/.env" ]; then
  set -a; . "$AGENT_DIR/.env"; set +a
fi

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"

# Mutex — prevent overlapping with a full cycle
exec 200>"$AGENT_LOCK_FILE"
if ! flock -n 200; then
  echo "Agent already running — skipping respond cycle"
  exit 0
fi
# Remove starting marker now that real flock is held
rm -f "${AGENT_LOCK_FILE}.starting"

CYCLE_TS="$(date +%Y%m%d-%H%M)"
CYCLE_LOG="logs/cycles/${CYCLE_TS}-respond.log"
mkdir -p logs/cycles

CYCLE_START_EPOCH=$(date +%s)

bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_start "Respond cycle (journal)"

# Clone/pull workspaces from agent.yaml
if [ "$WORKSPACES_COUNT" -gt 0 ] 2>/dev/null; then
  for i in $(seq 0 $((WORKSPACES_COUNT - 1))); do
    repo_var="WORKSPACE_${i}_REPO"; path_var="WORKSPACE_${i}_PATH"
    npm_var="WORKSPACE_${i}_NPM_INSTALL"
    ws_repo="${!repo_var}"; ws_path="${!path_var}"; ws_npm="${!npm_var}"

    if [ -d "$ws_path/.git" ]; then
      git -C "$ws_path" pull --ff-only 2>/dev/null || echo "Warning: pull failed for $ws_repo"
    else
      mkdir -p "$(dirname "$ws_path")"
      git clone "https://${GH_TOKEN}@github.com/${ws_repo}.git" "$ws_path" 2>/dev/null || {
        echo "Warning: clone failed for $ws_repo"
        continue
      }
    fi

    if [ "$ws_npm" = "true" ] && [ -f "$ws_path/package.json" ]; then
      (cd "$ws_path" && npm install --production 2>&1) || echo "Warning: npm install failed for $ws_repo"
    fi
  done
fi

# Read respond prompt from agent.yaml
if [ -n "$RESPOND_PROMPT_FILE" ] && [ -f "$RESPOND_PROMPT_FILE" ]; then
  PROMPT_FILE="$RESPOND_PROMPT_FILE"
else
  # Fallback prompt
  PROMPT_FILE="/tmp/agent-${AGENT_NAME}-respond-fallback.txt"
  cat > "$PROMPT_FILE" <<'FALLBACK'
You are waking up for a RESPOND cycle — not a full work cycle.
Read your journals for recent entries from your human and respond thoughtfully.
Then log a brief event and commit.
FALLBACK
fi

# Run Claude with retry
MAX_RETRIES=2
RETRY=0
CLAUDE_EXIT=1

while [ "$CLAUDE_EXIT" -ne 0 ] && [ "$RETRY" -lt "$MAX_RETRIES" ]; do
  if [ "$RETRY" -gt 0 ]; then
    bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" retry \
      "Retrying respond cycle (attempt $((RETRY+1)))"
    sleep 30
  fi

  set +e
  cat "$PROMPT_FILE" | claude --print \
    --allowedTools "Bash" "Read" "Write" "Edit" "Glob" "Grep" "WebSearch" "WebFetch" \
    2>&1 | tee "$CYCLE_LOG"
  CLAUDE_EXIT=${PIPESTATUS[1]}
  set -e

  RETRY=$((RETRY + 1))
done

cd "$AGENT_DIR"

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" error \
    "Respond cycle: Claude exited with code $CLAUDE_EXIT after $RETRY attempt(s)"
fi

CYCLE_END_EPOCH=$(date +%s)
CYCLE_DURATION_S=$((CYCLE_END_EPOCH - CYCLE_START_EPOCH))
CYCLE_DURATION_M=$((CYCLE_DURATION_S / 60))
echo "{\"ts\":\"$(date -Iseconds)\",\"type\":\"cycle_end\",\"summary\":\"Respond cycle complete\",\"duration_s\":${CYCLE_DURATION_S},\"duration_m\":${CYCLE_DURATION_M}}" >> "$AGENT_DIR/logs/events.jsonl"

bash "$FRAMEWORK_DIR/scripts/commit.sh" "$AGENT_DIR" "respond cycle"
