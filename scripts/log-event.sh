#!/bin/bash
# scripts/log-event.sh — Append a JSON event to the agent's events.jsonl
# Usage: log-event.sh <agent-dir> <type> <summary> [project]
set -e

AGENT_DIR="$1"
TYPE="$2"
SUMMARY="$3"
PROJECT="$4"

if [ -z "$AGENT_DIR" ] || [ -z "$TYPE" ] || [ -z "$SUMMARY" ]; then
  echo "Usage: log-event.sh <agent-dir> <type> <summary> [project]"
  exit 1
fi

ENTRY="{\"ts\":\"$(date -Iseconds)\",\"type\":\"$TYPE\",\"summary\":\"$SUMMARY\""
[ -n "$PROJECT" ] && ENTRY="$ENTRY,\"project\":\"$PROJECT\""
ENTRY="$ENTRY}"

mkdir -p "$AGENT_DIR/logs"
echo "$ENTRY" >> "$AGENT_DIR/logs/events.jsonl"
