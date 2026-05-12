#!/bin/bash
# scripts/publish-content.sh — Validate a drafted content item and publish it
# into <dataDir>/content/items/ (pass) or quarantine to
# <dataDir>/content/rejected/ (fail).
#
# Usage: publish-content.sh <agent-dir> <yaml-path> [--dry-run] [--skip-fetch]
#
# The agent's typical pattern:
#   1. Draft a YAML to /tmp/item-<id>.yaml
#   2. bash ../agent-portal/scripts/publish-content.sh . /tmp/item-<id>.yaml
#   3. On exit 0, the item is published. On exit 1, read the _validation
#      block in <dataDir>/content/rejected/<id>.yaml, fix URLs, retry.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:?Usage: publish-content.sh <agent-dir> <yaml-path> [--dry-run] [--skip-fetch]}"
YAML_PATH="${2:?Usage: publish-content.sh <agent-dir> <yaml-path> [--dry-run] [--skip-fetch]}"
shift 2

# Resolve DATA_DIR from portal.config.json (defaults to ".")
if [ -z "$DATA_DIR" ] && [ -f "$AGENT_DIR/portal.config.json" ]; then
  eval "$(bash "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$AGENT_DIR" 2>/dev/null | grep '^export DATA_DIR=')"
fi
export DATA_DIR="${DATA_DIR:-.}"

exec node "$FRAMEWORK_DIR/scripts/publish-content.js" "$YAML_PATH" --agent-dir "$AGENT_DIR" "$@"
