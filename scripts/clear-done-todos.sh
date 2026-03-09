#!/bin/bash
# scripts/clear-done-todos.sh — Remove checked todos from human_todos.md
# Usage: clear-done-todos.sh <agent-dir>
# Run at end of cycle (post-cycle hook) to clear completed todos.
# Only acts if human_todos.md exists and has checked items.

AGENT_DIR="${1:-.}"
TODOS_FILE="$AGENT_DIR/human_todos.md"

if [ ! -f "$TODOS_FILE" ]; then
  exit 0
fi

# Check if there are any checked todos
if ! grep -q '^\- \[x\] \|^\- \[X\] ' "$TODOS_FILE"; then
  exit 0
fi

# Remove checked todo lines (case-insensitive x)
sed -i '/^- \[[xX]\] /d' "$TODOS_FILE"

echo "Cleared completed todos from $TODOS_FILE"
