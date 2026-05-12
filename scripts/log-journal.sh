#!/bin/bash
# scripts/log-journal.sh — Append a timestamped journal entry
# Usage: log-journal.sh <agent-dir> <journal-file> <author> <tag> <content>
#
# journal-file is relative to <agent-dir>/<DATA_DIR>/journals/
# (e.g., "bobbo.md" or "ai-research.md"). DATA_DIR resolves from
# portal.config.json's dataDir field (default ".").
set -e

AGENT_DIR="$1"
JOURNAL_FILE="$2"
if [ "$JOURNAL_FILE" = "auto" ]; then
  JOURNAL_FILE="$(date +%Y-%m).md"
fi
AUTHOR="$3"
TAG="$4"
CONTENT="$5"

if [ -z "$AGENT_DIR" ] || [ -z "$JOURNAL_FILE" ] || [ -z "$AUTHOR" ] || [ -z "$TAG" ] || [ -z "$CONTENT" ]; then
  echo "Usage: log-journal.sh <agent-dir> <journal-file> <author> <tag> <content>"
  exit 1
fi

# Resolve DATA_DIR from portal.config.json (defaults to ".")
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$DATA_DIR" ] && [ -f "$AGENT_DIR/portal.config.json" ]; then
  eval "$(bash "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$AGENT_DIR" 2>/dev/null | grep '^export DATA_DIR=')"
fi
DATA_DIR="${DATA_DIR:-.}"

JOURNAL_PATH="$AGENT_DIR/$DATA_DIR/journals/$JOURNAL_FILE"
mkdir -p "$(dirname "$JOURNAL_PATH")"

{
  echo ""
  echo "### $(date -Iseconds) | $AUTHOR | $TAG"
  echo "$CONTENT"
} >> "$JOURNAL_PATH"
