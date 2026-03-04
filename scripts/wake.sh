#!/bin/bash
# scripts/wake.sh — Main autonomous cycle entrypoint for all agents.
# Usage: wake.sh [agent-dir]
# Reads agent.yaml for all config. Expects .env at agent-dir root.
set -e

# ── SETUP ──

# Source nvm so claude is on PATH (not inherited by cron)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Determine paths
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:-$(pwd)}"
cd "$AGENT_DIR"

# Step log — written before events.jsonl so we can diagnose startup failures
STEP_LOG="logs/cycles/wake-steps.log"
mkdir -p logs/cycles
step() {
  echo "$(date -Iseconds) $*" >> "$STEP_LOG"
}

step "wake.sh started (framework=$FRAMEWORK_DIR, agent=$AGENT_DIR)"

# Source .env for GH_TOKEN, Telegram tokens, git identity
if [ -f "$AGENT_DIR/.env" ]; then
  set -a; . "$AGENT_DIR/.env"; set +a
  step ".env sourced (GH_TOKEN=${GH_TOKEN:+set}${GH_TOKEN:-MISSING})"
else
  step ".env not found at $AGENT_DIR/.env"
fi

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"
step "config loaded (name=$AGENT_NAME)"

# Mutex — acquire lock immediately
exec 200>"$AGENT_LOCK_FILE"
if ! flock -n 200; then
  step "lock held — skipping cycle"
  bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped "Lock held by another cycle"
  exit 0
fi
step "lock acquired"

# Branch guard — ensure agent repo on main
CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "WARNING: agent repo on branch '$CURRENT_BRANCH', expected 'main'"
  if git diff --quiet && git diff --cached --quiet; then
    if git checkout main 2>/dev/null; then
      step "switched to main from '$CURRENT_BRANCH'"
    else
      step "failed to switch to main from '$CURRENT_BRANCH' — skipping"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped \
        "Could not switch from branch '$CURRENT_BRANCH' to main"
      exit 0
    fi
  else
    step "dirty working tree on branch '$CURRENT_BRANCH' — skipping"
    bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped \
      "Dirty working tree on branch '$CURRENT_BRANCH', cannot switch to main"
    exit 0
  fi
fi

# Track cycle timing
CYCLE_TS="$(date +%Y%m%d-%H%M)"
CYCLE_LOG="logs/cycles/${CYCLE_TS}.log"
CYCLE_START_EPOCH=$(date +%s)

# Create cycle-failed marker (deleted on success at end of cycle)
CYCLE_FAILED_MARKER="/tmp/agent-${AGENT_NAME}-cycle-failed"
touch "$CYCLE_FAILED_MARKER"

# Log cycle start
bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_start "Scheduled wake"
step "cycle_start logged"

# Pull latest framework code
step "framework pull starting"
if [ -z "$GH_TOKEN" ]; then
  step "framework pull skipped — GH_TOKEN not set"
else
  git -C "$FRAMEWORK_DIR" pull --ff-only \
    "https://${GH_TOKEN}@github.com/robhunter/agent-portal.git" main 200>&- 2>&1 || {
    step "framework pull failed (non-fatal, continuing)"
  }
fi
FRAMEWORK_COMMIT="$(git -C "$FRAMEWORK_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"
step "framework at $FRAMEWORK_COMMIT"

# Clone/pull workspaces from agent.yaml
if [ "$WORKSPACES_COUNT" -gt 0 ] 2>/dev/null; then
  for i in $(seq 0 $((WORKSPACES_COUNT - 1))); do
    repo_var="WORKSPACE_${i}_REPO"; path_var="WORKSPACE_${i}_PATH"
    npm_var="WORKSPACE_${i}_NPM_INSTALL"
    ws_repo="${!repo_var}"; ws_path="${!path_var}"; ws_npm="${!npm_var}"

    if [ -d "$ws_path/.git" ]; then
      step "pulling workspace $ws_repo"
      git -C "$ws_path" pull --ff-only 200>&- 2>&1 || step "workspace pull failed for $ws_repo (non-fatal)"
    else
      step "cloning workspace $ws_repo to $ws_path"
      mkdir -p "$(dirname "$ws_path")"
      git clone "https://${GH_TOKEN}@github.com/${ws_repo}.git" "$ws_path" 200>&- 2>&1 || {
        step "workspace clone failed for $ws_repo (non-fatal)"
        continue
      }
    fi

    if [ "$ws_npm" = "true" ] && [ -f "$ws_path/package.json" ]; then
      step "npm install for $ws_repo"
      (cd "$ws_path" && npm install --production 2>&1) || step "npm install failed for $ws_repo (non-fatal)"
    fi
  done
fi

# Run pre-cycle hooks
bash "$FRAMEWORK_DIR/scripts/run-hooks.sh" "$FRAMEWORK_DIR" "$AGENT_DIR" pre-cycle
step "pre-cycle hooks done"

# ── CLAUDE INVOCATION ──

# Close lock fd before piping to Claude to prevent fd leak into child processes
step "claude --print starting"

MAX_RETRIES=2
RETRY=0
CLAUDE_EXIT=1

set +e
while [ "$CLAUDE_EXIT" -ne 0 ] && [ "$RETRY" -lt "$MAX_RETRIES" ]; do
  if [ "$RETRY" -gt 0 ]; then
    step "retrying claude (attempt $((RETRY+1)))"
    bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" retry \
      "Retrying after failure (attempt $((RETRY+1)))"
    sleep 30
  fi

  cat "$WAKE_PROMPT_FILE" 200>&- | claude --print \
    --allowedTools "Bash" "Edit" "Write" "Read" "Glob" "Grep" "WebSearch" "WebFetch" \
    200>&- 2>&1 | tee 200>&- "$CYCLE_LOG"
  CLAUDE_EXIT=${PIPESTATUS[1]}

  RETRY=$((RETRY + 1))
done
set -e

step "claude --print finished (exit=$CLAUDE_EXIT, attempts=$RETRY)"

# ── POST-CYCLE ──

# Return to agent dir in case Claude changed directories
cd "$AGENT_DIR"

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" error \
    "Claude exited with code $CLAUDE_EXIT after $RETRY attempt(s)"
fi

# Run post-cycle hooks
bash "$FRAMEWORK_DIR/scripts/run-hooks.sh" "$FRAMEWORK_DIR" "$AGENT_DIR" post-cycle
step "post-cycle hooks done"

# Dispatch pending notification
NOTIFY_FILE="pending_notification.txt"
if [ -s "$NOTIFY_FILE" ]; then
  step "sending notification"
  bash "$FRAMEWORK_DIR/scripts/notify.sh" "$(cat "$NOTIFY_FILE")"
  rm -f "$NOTIFY_FILE"
fi

# Log cycle end with duration (before commit so it's in the committed state)
CYCLE_END_EPOCH=$(date +%s)
CYCLE_DURATION_S=$((CYCLE_END_EPOCH - CYCLE_START_EPOCH))
CYCLE_DURATION_M=$((CYCLE_DURATION_S / 60))
echo "{\"ts\":\"$(date -Iseconds)\",\"type\":\"cycle_end\",\"summary\":\"Cycle complete\",\"duration_s\":${CYCLE_DURATION_S},\"duration_m\":${CYCLE_DURATION_M}}" >> "$AGENT_DIR/logs/events.jsonl"
step "cycle complete (${CYCLE_DURATION_M}m ${CYCLE_DURATION_S}s)"

# Cycle succeeded — remove failure marker and update framework last-known-good
rm -f "$CYCLE_FAILED_MARKER"
node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml" \
  --set "framework-last-known-good=$FRAMEWORK_COMMIT"

# Git commit
step "commit starting"
bash "$FRAMEWORK_DIR/scripts/commit.sh" "$AGENT_DIR" "autonomous cycle" 200>&-
step "commit done"
