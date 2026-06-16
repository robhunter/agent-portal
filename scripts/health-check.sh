#!/bin/bash
# scripts/health-check.sh — Probe agent endpoints and append results to logs/health.jsonl
#
# Usage: health-check.sh <agent-dir> [--threshold <ms>] [--source <file>]
#
# Default mode: reads the `endpoints:` list from <agent-dir>/agent.yaml (a list
# of {url, type} objects), issues GET requests, measures latency, and writes
# one canonical JSONL line per endpoint to <agent-dir>/<DATA_DIR>/logs/health.jsonl
# (DATA_DIR resolves from portal.config.json, default ".") in the schema
# consumed by the portal Health tab:
#
#   {"ts","project","endpoint","status","latency_ms","ok"}
#
# --source <file> mode: reads endpoints from <agent-dir>/<file> using the
# multi-project shape:
#
#   projects:
#     - name: AgentDeals
#       endpoints:
#         - url: ...
#           type: ...
#
# Each project's endpoints are probed; the JSONL `project` field uses the
# project's `name` (not the agent's name from agent.yaml). Projects without
# an `endpoints:` field are skipped silently.
#
# Exit 0 if all endpoints respond 2xx (and beat --threshold if given), or if
# nothing is configured to probe.
# Exit 1 if any endpoint fails, on configuration errors, or on parse errors.
# Exit 2 if --source points to a nonexistent file.

set -e

AGENT_DIR=""
THRESHOLD=""
SOURCE_REL=""

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
    --source)
      SOURCE_REL="$2"
      shift 2
      ;;
    --source=*)
      SOURCE_REL="${1#--source=}"
      shift
      ;;
    -h|--help)
      echo "Usage: health-check.sh <agent-dir> [--threshold <ms>] [--source <file>]"
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
  echo "Usage: health-check.sh <agent-dir> [--threshold <ms>] [--source <file>]" >&2
  exit 1
fi

if [ -n "$THRESHOLD" ] && ! [[ "$THRESHOLD" =~ ^[0-9]+$ ]]; then
  echo "--threshold must be a positive integer (milliseconds), got: $THRESHOLD" >&2
  exit 1
fi

# Resolve DATA_DIR from portal.config.json (defaults to ".") so health.jsonl
# lands where the portal reads it. lib/routes/health.js reads via
# dataPath(config,'logs','health.jsonl') = <agent-dir>/<DATA_DIR>/logs/...;
# without this, a dataDir:"data" agent's results would be written to ./logs
# while the Health tab reads ./data/logs and shows nothing. Same idiom as the
# sibling path-writing scripts (log-event.sh, log-journal.sh).
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$DATA_DIR" ] && [ -f "$AGENT_DIR/portal.config.json" ]; then
  eval "$(bash "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$AGENT_DIR" 2>/dev/null | grep '^export DATA_DIR=')"
fi
DATA_DIR="${DATA_DIR:-.}"

LOG_DIR="$AGENT_DIR/$DATA_DIR/logs"
LOG="$LOG_DIR/health.jsonl"

if [ ! -d "$LOG_DIR" ]; then
  echo "Log dir not found at $LOG_DIR — create it before running health-check" >&2
  exit 1
fi

# Resolve and parse the configuration source. Both modes produce a flat list
# of {project, url, type} objects so the probe loop below is shape-agnostic.
if [ -n "$SOURCE_REL" ]; then
  if [ "${SOURCE_REL:0:1}" = "/" ]; then
    SOURCE_FILE="$SOURCE_REL"
  else
    SOURCE_FILE="$AGENT_DIR/$SOURCE_REL"
  fi
  if [ ! -f "$SOURCE_FILE" ]; then
    echo "Source file not found: $SOURCE_FILE" >&2
    exit 2
  fi
  PARSED=$(SOURCE_FILE="$SOURCE_FILE" python3 -c "
import os, sys, yaml, json
try:
    with open(os.environ['SOURCE_FILE']) as f:
        doc = yaml.safe_load(f) or {}
    if not isinstance(doc, dict):
        raise ValueError('top-level must be a mapping')
    projects = doc.get('projects') or []
    if not isinstance(projects, list):
        raise ValueError('projects must be a list')
    out = []
    for p in projects:
        if not isinstance(p, dict):
            raise ValueError('each project must be a mapping')
        name = p.get('name', '') or ''
        eps = p.get('endpoints') or []
        if not eps:
            continue
        if not isinstance(eps, list):
            raise ValueError('endpoints must be a list under project ' + str(name))
        for ep in eps:
            if not isinstance(ep, dict):
                raise ValueError('each endpoint must be a mapping under project ' + str(name))
            out.append({'project': name, 'url': ep.get('url', '') or '', 'type': ep.get('type', '') or ''})
    print(json.dumps({'pairs': out}))
except Exception as e:
    print('PARSE_ERROR:' + str(e), file=sys.stderr)
    sys.exit(1)
") || { echo "Failed to parse $SOURCE_FILE" >&2; exit 1; }
else
  YAML="$AGENT_DIR/agent.yaml"
  if [ ! -f "$YAML" ]; then
    echo "agent.yaml not found at $YAML" >&2
    exit 1
  fi
  PARSED=$(YAML_FILE="$YAML" python3 -c "
import os, sys, yaml, json
try:
    with open(os.environ['YAML_FILE']) as f:
        doc = yaml.safe_load(f) or {}
    name = doc.get('name', '') or ''
    eps = doc.get('endpoints') or []
    out = [{'project': name, 'url': (ep.get('url', '') or '') if isinstance(ep, dict) else '', 'type': (ep.get('type', '') or '') if isinstance(ep, dict) else ''} for ep in eps]
    print(json.dumps({'pairs': out}))
except Exception as e:
    print('PARSE_ERROR:' + str(e), file=sys.stderr)
    sys.exit(1)
") || { echo "Failed to parse $YAML" >&2; exit 1; }
fi

PAIR_COUNT=$(echo "$PARSED" | jq '.pairs | length')
if [ "$PAIR_COUNT" = "0" ]; then
  if [ -n "$SOURCE_REL" ]; then
    echo "No project endpoints configured in $SOURCE_FILE — nothing to probe" >&2
  else
    echo "No endpoints configured in $YAML — nothing to probe" >&2
  fi
  exit 0
fi

ALL_OK=true

# Iterate the flat (project, url, type) list. type is informational in v1;
# both http and mcp endpoints are probed via GET.
while IFS= read -r pair; do
  [ -z "$pair" ] && continue
  PROJECT=$(echo "$pair" | jq -r '.project')
  URL=$(echo "$pair" | jq -r '.url // empty')

  if [ -z "$URL" ]; then
    echo "Endpoint missing url field: $pair" >&2
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
done < <(echo "$PARSED" | jq -c '.pairs[]')

if [ "$ALL_OK" = "true" ]; then
  exit 0
else
  exit 1
fi
