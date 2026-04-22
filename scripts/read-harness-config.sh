#!/bin/bash
# scripts/read-harness-config.sh — Read harness config from portal.config.json
#
# Usage: eval "$(bash read-harness-config.sh /path/to/agent-dir)"
#
# Exports: HARNESS_TYPE, HARNESS_CMD, HARNESS_EXTRA_FLAGS
# Defaults to claude-code with current hardcoded behavior if no harness config found.

AGENT_DIR="${1:-.}"
PORTAL_CONFIG="$AGENT_DIR/portal.config.json"

if [ -f "$PORTAL_CONFIG" ] && command -v node >/dev/null 2>&1; then
  eval "$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$PORTAL_CONFIG', 'utf-8'));
    const h = c.harness || {};
    console.log('HARNESS_TYPE=' + JSON.stringify(h.type || 'claude-code'));
    console.log('HARNESS_CMD=' + JSON.stringify(h.command || 'claude --print'));
    console.log('HARNESS_EXTRA_FLAGS=' + JSON.stringify(h.extraFlags || ''));
  ")"
else
  HARNESS_TYPE="claude-code"
  HARNESS_CMD="claude --print"
  HARNESS_EXTRA_FLAGS=""
fi

echo "export HARNESS_TYPE=${HARNESS_TYPE@Q}"
echo "export HARNESS_CMD=${HARNESS_CMD@Q}"
echo "export HARNESS_EXTRA_FLAGS=${HARNESS_EXTRA_FLAGS@Q}"
