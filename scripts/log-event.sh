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

# Build the JSON line with python3 (a hard framework dependency, used the same
# way in wake.sh/health-check.sh) so that double-quotes, backslashes, or
# newlines in the type/summary/project are escaped correctly. Raw string
# interpolation here silently produced invalid JSONL whenever a summary
# contained a `"` (common — e.g. Shipped "dark mode"), and downstream consumers
# that JSON.parse line-by-line then dropped the event entirely.
ENTRY="$(EVENT_TS="$(date -Iseconds)" EVENT_TYPE="$TYPE" EVENT_SUMMARY="$SUMMARY" EVENT_PROJECT="$PROJECT" python3 -c '
import json, os
entry = {
    "ts": os.environ["EVENT_TS"],
    "type": os.environ["EVENT_TYPE"],
    "summary": os.environ["EVENT_SUMMARY"],
}
if os.environ.get("EVENT_PROJECT"):
    entry["project"] = os.environ["EVENT_PROJECT"]
print(json.dumps(entry, ensure_ascii=False, separators=(",", ":")))
')"

mkdir -p "$AGENT_DIR/$DATA_DIR/logs"
echo "$ENTRY" >> "$AGENT_DIR/$DATA_DIR/logs/events.jsonl"
