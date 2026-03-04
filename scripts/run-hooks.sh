#!/bin/bash
# scripts/run-hooks.sh — Run agent hooks for an extension point.
# Usage: run-hooks.sh <framework-dir> <agent-dir> <extension-point>
#
# Runs all .sh scripts in agent-dir/hooks/<extension-point>.d/ in alphabetical order.
# Skips hooks listed in framework's core-hooks.yaml (promoted hooks).
# Pre-cycle hook failure aborts with exit 1. Post-cycle/post-start failures are warnings.

FRAMEWORK_DIR="$1"
AGENT_DIR="$2"
EXTENSION_POINT="$3"

if [ -z "$FRAMEWORK_DIR" ] || [ -z "$AGENT_DIR" ] || [ -z "$EXTENSION_POINT" ]; then
  echo "Usage: run-hooks.sh <framework-dir> <agent-dir> <extension-point>"
  exit 1
fi

HOOKS_DIR="$AGENT_DIR/hooks/${EXTENSION_POINT}.d"

# No hooks directory — nothing to do
[ -d "$HOOKS_DIR" ] || exit 0

# Load core hooks registry (hook names that have been promoted to framework)
CORE_HOOKS=""
if [ -f "$FRAMEWORK_DIR/core-hooks.yaml" ]; then
  CORE_HOOKS=$(node "$FRAMEWORK_DIR/scripts/read-core-hooks.js" \
    "$FRAMEWORK_DIR/core-hooks.yaml" "$EXTENSION_POINT" 2>/dev/null) || true
fi

for hook in "$HOOKS_DIR"/*.sh; do
  [ -f "$hook" ] || continue
  hook_name="$(basename "$hook" .sh)"

  # Skip if promoted to core
  if [ -n "$CORE_HOOKS" ] && echo "$CORE_HOOKS" | grep -qx "$hook_name"; then
    echo "Skipping hook $hook_name — handled by framework"
    continue
  fi

  echo "Running hook: $hook_name"
  bash "$hook" || {
    if [ "$EXTENSION_POINT" = "pre-cycle" ]; then
      echo "Pre-cycle hook $hook_name failed — aborting cycle"
      exit 1
    else
      echo "Warning: $EXTENSION_POINT hook $hook_name failed"
    fi
  }
done
