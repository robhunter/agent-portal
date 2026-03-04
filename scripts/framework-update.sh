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

# Pull latest framework
if [ -n "$GH_TOKEN" ]; then
  git -C "$FRAMEWORK_DIR" pull --ff-only \
    "https://${GH_TOKEN}@github.com/robhunter/agent-portal.git" main 2>&1 || {
    echo "Warning: framework pull failed (continuing with current version)"
  }
fi

# Record current framework commit
FRAMEWORK_COMMIT="$(git -C "$FRAMEWORK_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"

# Rollback check
if [ -f "$CYCLE_FAILED_MARKER" ] && [ -n "$FRAMEWORK_LAST_KNOWN_GOOD" ] && [ "$FRAMEWORK_LAST_KNOWN_GOOD" != "null" ]; then
  if [ "$FRAMEWORK_COMMIT" != "$FRAMEWORK_LAST_KNOWN_GOOD" ]; then
    echo "Previous cycle failed and framework changed — rolling back to $FRAMEWORK_LAST_KNOWN_GOOD"
    git -C "$FRAMEWORK_DIR" checkout "$FRAMEWORK_LAST_KNOWN_GOOD" 2>&1 || {
      echo "ERROR: rollback failed"
      bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" error \
        "Framework rollback to $FRAMEWORK_LAST_KNOWN_GOOD failed"
    }
    FRAMEWORK_COMMIT="$FRAMEWORK_LAST_KNOWN_GOOD"
    bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" rollback \
      "Rolled back framework to $FRAMEWORK_LAST_KNOWN_GOOD"
  fi
fi

# Export for wake.sh to use after a successful cycle
echo "FRAMEWORK_COMMIT='$FRAMEWORK_COMMIT'"
