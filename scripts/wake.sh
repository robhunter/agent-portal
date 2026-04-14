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

# Source sandcat profile scripts if available (Sandcat containers inject
# env vars via /etc/profile.d/ but cron doesn't inherit them)
for _f in /etc/profile.d/sandcat-*.sh; do
  [ -r "$_f" ] && . "$_f"
done

# Source .env if present (pre-Sandcat containers use .env for secrets)
if [ -f "$AGENT_DIR/.env" ]; then
  set -a; . "$AGENT_DIR/.env"; set +a
  step ".env sourced (GH_TOKEN=${GH_TOKEN:+set}${GH_TOKEN:-MISSING})"
else
  step ".env not found at $AGENT_DIR/.env (skipping — using container environment)"
fi

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"
step "config loaded (name=$AGENT_NAME)"

# Set timezone if configured
if [ -n "$AGENT_TIMEZONE" ]; then
  export TZ="$AGENT_TIMEZONE"
  step "timezone set to $TZ"
fi

# ── LOCK ACQUISITION ──

# Stale lock timeout in seconds (default: 90 minutes)
LOCK_STALE_TIMEOUT="${AGENT_LOCK_STALE_TIMEOUT:-5400}"

exec 200>"$AGENT_LOCK_FILE"
if ! flock -n 200; then
  step "lock held — checking for stale holder"

  # Write our PID to help with debugging
  HOLDER_PID=$(fuser "$AGENT_LOCK_FILE" 2>/dev/null | tr -d ' ')
  if [ -n "$HOLDER_PID" ]; then
    HOLDER_AGE=$(ps -o etimes= -p "$HOLDER_PID" 2>/dev/null | tr -d ' ')
    step "lock holder PID=$HOLDER_PID age=${HOLDER_AGE:-unknown}s (threshold=${LOCK_STALE_TIMEOUT}s)"

    if [ "${HOLDER_AGE:-0}" -gt "$LOCK_STALE_TIMEOUT" ]; then
      step "stale lock detected — killing PID $HOLDER_PID (age ${HOLDER_AGE}s > ${LOCK_STALE_TIMEOUT}s)"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" recovery \
        "Killed stale lock holder PID $HOLDER_PID (age ${HOLDER_AGE}s)"
      kill "$HOLDER_PID" 2>/dev/null
      sleep 2
      # Force kill if still alive
      kill -0 "$HOLDER_PID" 2>/dev/null && kill -9 "$HOLDER_PID" 2>/dev/null
      sleep 1

      # Retry lock acquisition
      if ! flock -n 200; then
        step "lock still held after killing stale holder — skipping"
        bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped \
          "Lock held by another cycle (stale kill failed)"
        exit 0
      fi
      step "lock acquired after stale holder cleanup"
    else
      step "lock holder is recent (${HOLDER_AGE}s < ${LOCK_STALE_TIMEOUT}s) — skipping"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped "Lock held by another cycle"
      exit 0
    fi
  else
    # Can't find holder PID — lock file exists but no process found
    # This likely means the holder died without releasing the lock
    step "no holder PID found — lock is orphaned, retrying"
    bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" recovery \
      "Orphaned lock detected (no holder PID), forcing cleanup"
    # Close our fd, delete the file (unlinking the old inode that holds
    # the orphaned flock), then create a fresh file on a new inode.
    exec 200>&-
    rm -f "$AGENT_LOCK_FILE"
    exec 200>"$AGENT_LOCK_FILE"
    if ! flock -n 200; then
      step "lock still held after orphan cleanup — skipping"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped \
        "Lock held by another cycle (orphan cleanup failed)"
      exit 0
    fi
    step "lock acquired after orphan cleanup"
  fi
fi

# Write our PID to lock file for debugging
echo $$ > "$AGENT_LOCK_FILE"

# Remove starting marker now that real flock is held
rm -f "${AGENT_LOCK_FILE}.starting"
step "lock acquired (PID=$$)"

# Trap to ensure lock is released on any exit (normal, error, signal)
trap 'flock -u 200 2>/dev/null; exec 200>&- 2>/dev/null; step "lock released via trap"' EXIT

# ── BRANCH GUARD ──

# Track consecutive dirty-branch skips for self-healing
BRANCH_SKIP_COUNTER="/tmp/agent-${AGENT_NAME}-branch-skip-count"

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "WARNING: agent repo on branch '$CURRENT_BRANCH', expected 'main'"
  if git diff --quiet && git diff --cached --quiet; then
    if git checkout main 2>/dev/null; then
      step "switched to main from '$CURRENT_BRANCH'"
      rm -f "$BRANCH_SKIP_COUNTER"
    else
      step "failed to switch to main from '$CURRENT_BRANCH' — skipping"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped \
        "Could not switch from branch '$CURRENT_BRANCH' to main"
      exit 0
    fi
  else
    # Dirty working tree on non-main branch — attempt recovery after 3 skips
    SKIP_COUNT=$(cat "$BRANCH_SKIP_COUNTER" 2>/dev/null || echo 0)
    SKIP_COUNT=$((SKIP_COUNT + 1))
    echo "$SKIP_COUNT" > "$BRANCH_SKIP_COUNTER"

    if [ "$SKIP_COUNT" -ge 3 ]; then
      step "dirty branch '$CURRENT_BRANCH' skip #$SKIP_COUNT — attempting recovery"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" recovery \
        "Auto-recovering from dirty branch '$CURRENT_BRANCH' after $SKIP_COUNT skips"

      # Try stash + checkout (non-destructive)
      if git stash 2>/dev/null && git checkout main 2>/dev/null; then
        step "recovered via git stash + checkout main"
        rm -f "$BRANCH_SKIP_COUNTER"
      else
        # Last resort: force checkout (destructive but better than bricked)
        step "stash failed — force checkout main"
        if git checkout -f main 2>/dev/null; then
          step "recovered via force checkout main (changes lost)"
          bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" recovery \
            "Force checkout main — uncommitted changes on '$CURRENT_BRANCH' were lost"
          rm -f "$BRANCH_SKIP_COUNTER"
        else
          step "all recovery attempts failed — skipping"
          bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped \
            "Dirty working tree on branch '$CURRENT_BRANCH', recovery failed"
          exit 0
        fi
      fi
    else
      step "dirty working tree on branch '$CURRENT_BRANCH' — skip #$SKIP_COUNT (recovery at 3)"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_skipped \
        "Dirty working tree on branch '$CURRENT_BRANCH', cannot switch to main (skip $SKIP_COUNT/3)"
      exit 0
    fi
  fi
else
  # On main — reset skip counter
  rm -f "$BRANCH_SKIP_COUNTER" 2>/dev/null
fi

# Track cycle timing
CYCLE_TS="$(date +%Y%m%d-%H%M)"
CYCLE_LOG="logs/cycles/${CYCLE_TS}.log"
CYCLE_START_EPOCH=$(date +%s)

# Log cycle start
bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_start "Scheduled wake"
step "cycle_start logged"

# Pull latest framework code + rollback check
step "framework update starting"
eval "$(bash "$FRAMEWORK_DIR/scripts/framework-update.sh" "$FRAMEWORK_DIR" "$AGENT_DIR")"
step "framework at $FRAMEWORK_COMMIT"

# Create cycle-failed marker (deleted on success at end of cycle)
# Placed AFTER framework update so the marker reflects the PREVIOUS cycle's status,
# not the current one — framework-update.sh uses this marker for rollback decisions.
CYCLE_FAILED_MARKER="/tmp/agent-${AGENT_NAME}-cycle-failed"
touch "$CYCLE_FAILED_MARKER"

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
      (cd "$ws_path" && npm install --production 200>&- 2>&1) || step "npm install failed for $ws_repo (non-fatal)"
    fi
  done
fi

# Run pre-cycle hooks
bash "$FRAMEWORK_DIR/scripts/run-hooks.sh" "$FRAMEWORK_DIR" "$AGENT_DIR" pre-cycle
step "pre-cycle hooks done"

# ── CLAUDE AUTH CHECK ──

# Record auth confirmation timestamp (non-fatal)
AUTH_CONFIRMED_FILE="$AGENT_DIR/logs/.auth-last-confirmed"
if claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
  date -Iseconds > "$AUTH_CONFIRMED_FILE" 2>/dev/null || true
  step "claude auth confirmed"
else
  step "claude auth NOT confirmed"
fi

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
    "mcp__playwright__browser_click" "mcp__playwright__browser_close" \
    "mcp__playwright__browser_console_messages" "mcp__playwright__browser_drag" \
    "mcp__playwright__browser_evaluate" "mcp__playwright__browser_file_upload" \
    "mcp__playwright__browser_fill_form" "mcp__playwright__browser_handle_dialog" \
    "mcp__playwright__browser_hover" "mcp__playwright__browser_navigate" \
    "mcp__playwright__browser_navigate_back" "mcp__playwright__browser_network_requests" \
    "mcp__playwright__browser_press_key" "mcp__playwright__browser_resize" \
    "mcp__playwright__browser_run_code" "mcp__playwright__browser_select_option" \
    "mcp__playwright__browser_snapshot" "mcp__playwright__browser_tabs" \
    "mcp__playwright__browser_take_screenshot" "mcp__playwright__browser_type" \
    "mcp__playwright__browser_wait_for" \
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

# Memory consolidation (Phase 3) — runs when cycle count threshold is met
bash "$FRAMEWORK_DIR/scripts/consolidate-memory.sh" "$AGENT_DIR" 2>&1 | while IFS= read -r line; do step "consolidation: $line"; done || \
  step "consolidation: skipped or failed (non-fatal)"

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

# Explicit lock release (trap will also fire, but be explicit)
flock -u 200 2>/dev/null
exec 200>&- 2>/dev/null
step "lock released explicitly"
