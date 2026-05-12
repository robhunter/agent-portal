#!/bin/bash
# scripts/log-event.sh — Append a JSON event to the agent's events.jsonl
# Usage: log-event.sh <agent-dir> <type> <summary> [project]
#
# Respects portal.config.json's dataDir field (default "."). Writes to
# <agent-dir>/<DATA_DIR>/logs/events.jsonl.
set -e

AGENT_DIR="$1"
TYPE="$2"
SUMMARY="$3"
PROJECT="$4"

if [ -z "$AGENT_DIR" ] || [ -z "$TYPE" ] || [ -z "$SUMMARY" ]; then
  echo "Usage: log-event.sh <agent-dir> <type> <summary> [project]"
  exit 1
fi

# Resolve DATA_DIR from portal.config.json (defaults to ".")
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$DATA_DIR" ] && [ -f "$AGENT_DIR/portal.config.json" ]; then
  eval "$(bash "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$AGENT_DIR" 2>/dev/null | grep '^export DATA_DIR=')"
fi
DATA_DIR="${DATA_DIR:-.}"

ENTRY="{\"ts\":\"$(date -Iseconds)\",\"type\":\"$TYPE\",\"summary\":\"$SUMMARY\""
[ -n "$PROJECT" ] && ENTRY="$ENTRY,\"project\":\"$PROJECT\""
ENTRY="$ENTRY}"

mkdir -p "$AGENT_DIR/$DATA_DIR/logs"
echo "$ENTRY" >> "$AGENT_DIR/$DATA_DIR/logs/events.jsonl"
