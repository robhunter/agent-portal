#!/bin/bash
# scripts/framework-update.sh — Pull latest framework, handle rollback if needed.
# Usage: framework-update.sh <framework-dir> <agent-dir>
#
# Called by wake.sh before the cycle starts. Exports FRAMEWORK_COMMIT for
# wake.sh to use when updating framework-last-known-good after success.
#
# Rollback triggers when:
# 1. The framework commit changed since last-known-good, AND
# 2. The previous cycle failed (marker file exists)
set -e

FRAMEWORK_DIR="${1:?Usage: framework-update.sh <framework-dir> <agent-dir>}"
AGENT_DIR="${2:?Usage: framework-update.sh <framework-dir> <agent-dir>}"

# Read agent config for rollback state
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"

CYCLE_FAILED_MARKER="/tmp/agent-${AGENT_NAME}-cycle-failed"
PORTAL_PID_FILE="/tmp/${AGENT_NAME}-portal.pid"

# Record commit before pull to detect changes
PRE_PULL_COMMIT="$(git -C "$FRAMEWORK_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"

# Pull latest framework (informational output to stderr)
# Derive remote URL from git origin rather than hardcoding
REMOTE_URL=$(git -C "$FRAMEWORK_DIR" remote get-url origin 2>/dev/null || echo "")
if [ -n "$REMOTE_URL" ]; then
  # Inject GH_TOKEN for HTTPS authentication if available
  if [ -n "$GH_TOKEN" ]; then
    REMOTE_URL=$(echo "$REMOTE_URL" | sed "s|https://github.com/|https://${GH_TOKEN}@github.com/|")
  fi
  git -C "$FRAMEWORK_DIR" pull --ff-only "$REMOTE_URL" main >&2 2>&1 || {
    echo "Warning: framework pull failed (continuing with current version)" >&2
  }
else
  echo "Warning: no git remote configured for framework directory" >&2
fi

# Record current framework commit
FRAMEWORK_COMMIT="$(git -C "$FRAMEWORK_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"

# Restart portal if framework code changed
if [ "$PRE_PULL_COMMIT" != "$FRAMEWORK_COMMIT" ] && [ "$PRE_PULL_COMMIT" != "unknown" ]; then
  echo "Framework updated ($PRE_PULL_COMMIT → $FRAMEWORK_COMMIT) — restarting portal" >&2
  if [ -f "$PORTAL_PID_FILE" ]; then
    PORTAL_PID=$(cat "$PORTAL_PID_FILE" 2>/dev/null)
    if [ -n "$PORTAL_PID" ] && kill -0 "$PORTAL_PID" 2>/dev/null; then
      kill "$PORTAL_PID" 2>/dev/null
      echo "Killed portal process (PID $PORTAL_PID) — supervisor will restart with new code" >&2
    fi
  fi
fi

# Rollback check
if [ -f "$CYCLE_FAILED_MARKER" ] && [ -n "$FRAMEWORK_LAST_KNOWN_GOOD" ] && [ "$FRAMEWORK_LAST_KNOWN_GOOD" != "null" ]; then
  if [ "$FRAMEWORK_COMMIT" != "$FRAMEWORK_LAST_KNOWN_GOOD" ]; then
    echo "Previous cycle failed and framework changed — rolling back to $FRAMEWORK_LAST_KNOWN_GOOD" >&2
    git -C "$FRAMEWORK_DIR" checkout "$FRAMEWORK_LAST_KNOWN_GOOD" >&2 2>&1 || {
      echo "ERROR: rollback failed" >&2
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" error \
        "Framework rollback to $FRAMEWORK_LAST_KNOWN_GOOD failed"
    }
    FRAMEWORK_COMMIT="$FRAMEWORK_LAST_KNOWN_GOOD"
    bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" rollback \
      "Rolled back framework to $FRAMEWORK_LAST_KNOWN_GOOD"
    # Restart portal again with the rolled-back code
    if [ -f "$PORTAL_PID_FILE" ]; then
      PORTAL_PID=$(cat "$PORTAL_PID_FILE" 2>/dev/null)
      if [ -n "$PORTAL_PID" ] && kill -0 "$PORTAL_PID" 2>/dev/null; then
        kill "$PORTAL_PID" 2>/dev/null
        echo "Killed portal after rollback (PID $PORTAL_PID)" >&2
      fi
    fi
  fi
fi

# Export for wake.sh to use after a successful cycle
echo "FRAMEWORK_COMMIT='$FRAMEWORK_COMMIT'"
