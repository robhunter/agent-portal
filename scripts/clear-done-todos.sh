#!/bin/bash
# scripts/clear-done-todos.sh — Remove checked todos from human_todos.md
# Usage: clear-done-todos.sh <agent-dir>
# Run at end of cycle (post-cycle hook) to clear completed todos.
# Only acts if human_todos.md exists and has checked items under ## Todos;
# checked items in other sections (an archive, say) stay.
# Respects portal.config.json's dataDir (default ".").

AGENT_DIR="${1:-.}"
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "$DATA_DIR" ] && [ -f "$AGENT_DIR/portal.config.json" ]; then
  eval "$(bash "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$AGENT_DIR" 2>/dev/null | grep '^export DATA_DIR=')"
fi
DATA_DIR="${DATA_DIR:-.}"

TODOS_FILE="$AGENT_DIR/$DATA_DIR/human_todos.md"

if [ ! -f "$TODOS_FILE" ]; then
  exit 0
fi

node "$FRAMEWORK_DIR/scripts/clear-done-todos.js" "$TODOS_FILE"
