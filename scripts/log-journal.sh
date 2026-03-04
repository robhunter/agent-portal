#!/bin/bash
# scripts/log-journal.sh — Append a timestamped journal entry
# Usage: log-journal.sh <agent-dir> <journal-file> <author> <tag> <content>
#
# journal-file is relative to agent-dir/journals/ (e.g., "bobbo.md" or "ai-research.md")
set -e

AGENT_DIR="$1"
JOURNAL_FILE="$2"
AUTHOR="$3"
TAG="$4"
CONTENT="$5"

if [ -z "$AGENT_DIR" ] || [ -z "$JOURNAL_FILE" ] || [ -z "$AUTHOR" ] || [ -z "$TAG" ] || [ -z "$CONTENT" ]; then
  echo "Usage: log-journal.sh <agent-dir> <journal-file> <author> <tag> <content>"
  exit 1
fi

JOURNAL_PATH="$AGENT_DIR/journals/$JOURNAL_FILE"
mkdir -p "$(dirname "$JOURNAL_PATH")"

{
  echo ""
  echo "### $(date -Iseconds) | $AUTHOR | $TAG"
  echo "$CONTENT"
} >> "$JOURNAL_PATH"
