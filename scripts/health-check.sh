#!/bin/bash
# scripts/health-check.sh — Probe agent endpoints and append results to logs/health.jsonl
#
# Usage: health-check.sh <agent-dir> [--threshold <ms>]
#
# Reads the `endpoints:` list from <agent-dir>/agent.yaml (a list of
# {url, type} objects), issues GET requests, measures latency, and writes
# one canonical JSONL line per endpoint to <agent-dir>/logs/health.jsonl
# in the schema consumed by the portal Health tab:
#
#   {"ts","project","endpoint","status","latency_ms","ok"}
#
# Exit 0 if all endpoints respond 2xx (and beat --threshold if given).
# Exit 1 if any endpoint fails. Exit 0 with stderr warning if no endpoints
# are configured.

set -e

AGENT_DIR=""
THRESHOLD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    --threshold=*)
      THRESHOLD="${1#--threshold=}"
      shift
      ;;
    -h|--help)
      echo "Usage: health-check.sh <agent-dir> [--threshold <ms>]"
      exit 0
      ;;
    *)
      if [ -z "$AGENT_DIR" ]; then
        AGENT_DIR="$1"
      else
        echo "Unexpected argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [ -z "$AGENT_DIR" ]; then
  echo "Usage: health-check.sh <agent-dir> [--threshold <ms>]" >&2
  exit 1
fi

if [ -n "$THRESHOLD" ] && ! [[ "$THRESHOLD" =~ ^[0-9]+$ ]]; then
  echo "--threshold must be a positive integer (milliseconds), got: $THRESHOLD" >&2
  exit 1
fi

YAML="$AGENT_DIR/agent.yaml"
LOG_DIR="$AGENT_DIR/logs"
LOG="$LOG_DIR/health.jsonl"

if [ ! -f "$YAML" ]; then
  echo "agent.yaml not found at $YAML" >&2
  exit 1
fi

if [ ! -d "$LOG_DIR" ]; then
  echo "Log dir not found at $LOG_DIR — create it before running health-check" >&2
  exit 1
fi

# Parse name + endpoints via python3 (yaml is part of the standard agentbox image
# and is what operational/tools/load-config.py already relies on).
PARSED=$(python3 -c "
import sys, yaml, json
try:
    with open('$YAML') as f:
        doc = yaml.safe_load(f) or {}
    print(json.dumps({'name': doc.get('name', ''), 'endpoints': doc.get('endpoints') or []}))
except Exception as e:
    print('PARSE_ERROR:' + str(e), file=sys.stderr)
    sys.exit(1)
") || { echo "Failed to parse $YAML" >&2; exit 1; }

PROJECT=$(echo "$PARSED" | jq -r '.name')

EP_COUNT=$(echo "$PARSED" | jq '.endpoints | length')
if [ "$EP_COUNT" = "0" ]; then
  echo "No endpoints configured in $YAML — nothing to probe" >&2
  exit 0
fi

ALL_OK=true

# Iterate endpoints. Each is a {url, type} object. type is informational
# in v1; both http and mcp endpoints are probed via GET.
while IFS= read -r ep; do
  [ -z "$ep" ] && continue
  URL=$(echo "$ep" | jq -r '.url // empty')

  if [ -z "$URL" ]; then
    echo "Endpoint missing url field: $ep" >&2
    ALL_OK=false
    continue
  fi

  TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Capture status + total time. On connection failure curl exits non-zero;
  # we substitute "000 0" so the run still logs a result.
  RESULT=$(curl -s -o /dev/null -w "%{http_code} %{time_total}\n" --max-time 10 "$URL" 2>/dev/null) || RESULT="000 0"
  STATUS=$(echo "$RESULT" | awk '{print $1}')
  TIME_S=$(echo "$RESULT" | awk '{print $2}')
  LATENCY_MS=$(awk -v t="$TIME_S" 'BEGIN { printf "%d", t * 1000 }')

  OK=false
  if [ "$STATUS" -ge 200 ] 2>/dev/null && [ "$STATUS" -lt 300 ] 2>/dev/null; then
    OK=true
  fi
  if [ -n "$THRESHOLD" ] && [ "$LATENCY_MS" -gt "$THRESHOLD" ]; then
    OK=false
  fi

  if [ "$OK" = "false" ]; then
    ALL_OK=false
  fi

  jq -nc \
    --arg ts "$TS" \
    --arg project "$PROJECT" \
    --arg endpoint "$URL" \
    --argjson status "$STATUS" \
    --argjson latency_ms "$LATENCY_MS" \
    --argjson ok "$OK" \
    '{ts: $ts, project: $project, endpoint: $endpoint, status: $status, latency_ms: $latency_ms, ok: $ok}' \
    >> "$LOG"
done < <(echo "$PARSED" | jq -c '.endpoints[]')

if [ "$ALL_OK" = "true" ]; then
  exit 0
else
  exit 1
fi
