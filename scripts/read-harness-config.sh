#!/bin/bash
# scripts/read-harness-config.sh — Read harness + data dir config from portal.config.json
#
# Usage: eval "$(bash read-harness-config.sh /path/to/agent-dir)"
#
# Exports: HARNESS_TYPE, HARNESS_CMD, HARNESS_EXTRA_FLAGS, DATA_DIR
# Defaults: claude-code harness, DATA_DIR="." (backwards-compatible with the
# pre-dataDir layout where all framework state lives at the agent root).

AGENT_DIR="${1:-.}"
PORTAL_CONFIG="$AGENT_DIR/portal.config.json"

# Default extraFlags for claude-code: --effort max + full allowedTools list
CLAUDE_CODE_DEFAULT_FLAGS="--effort max --allowedTools Bash Edit Write Read Glob Grep WebSearch WebFetch mcp__playwright__browser_click mcp__playwright__browser_close mcp__playwright__browser_console_messages mcp__playwright__browser_drag mcp__playwright__browser_evaluate mcp__playwright__browser_file_upload mcp__playwright__browser_fill_form mcp__playwright__browser_handle_dialog mcp__playwright__browser_hover mcp__playwright__browser_navigate mcp__playwright__browser_navigate_back mcp__playwright__browser_network_requests mcp__playwright__browser_press_key mcp__playwright__browser_resize mcp__playwright__browser_run_code mcp__playwright__browser_select_option mcp__playwright__browser_snapshot mcp__playwright__browser_tabs mcp__playwright__browser_take_screenshot mcp__playwright__browser_type mcp__playwright__browser_wait_for"

if [ -f "$PORTAL_CONFIG" ] && command -v node >/dev/null 2>&1; then
  eval "$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$PORTAL_CONFIG', 'utf-8'));
    const h = c.harness || {};
    console.log('HARNESS_TYPE=' + JSON.stringify(h.type || 'claude-code'));
    console.log('HARNESS_CMD=' + JSON.stringify(h.command || 'claude --print'));
    console.log('HARNESS_EXTRA_FLAGS=' + JSON.stringify(h.extraFlags || ''));
    console.log('DATA_DIR=' + JSON.stringify(c.dataDir || '.'));
  ")"
else
  HARNESS_TYPE="claude-code"
  HARNESS_CMD="claude --print"
  HARNESS_EXTRA_FLAGS=""
  DATA_DIR="."
fi

# Apply claude-code defaults when no extraFlags configured
if [ "$HARNESS_TYPE" = "claude-code" ] && [ -z "$HARNESS_EXTRA_FLAGS" ]; then
  HARNESS_EXTRA_FLAGS="$CLAUDE_CODE_DEFAULT_FLAGS"
fi

echo "export HARNESS_TYPE=${HARNESS_TYPE@Q}"
echo "export HARNESS_CMD=${HARNESS_CMD@Q}"
echo "export HARNESS_EXTRA_FLAGS=${HARNESS_EXTRA_FLAGS@Q}"
echo "export DATA_DIR=${DATA_DIR@Q}"
