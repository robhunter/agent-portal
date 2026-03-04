#!/bin/bash
# scripts/cron-setup.sh — Install or show cron entries from agent.yaml.
# Usage:
#   cron-setup.sh <agent-dir>          # Show the cron lines
#   cron-setup.sh <agent-dir> install  # Install them
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:?Usage: cron-setup.sh <agent-dir> [install]}"
ACTION="$2"

cd "$AGENT_DIR"

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"

# nvm sourcing prefix so claude is on PATH in cron
NVM_SOURCE='export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" &&'

# Main wake entry from agent.yaml
WAKE_LINE="${AGENT_CRON_SCHEDULE} root ${NVM_SOURCE} cd ${AGENT_DIR} && bash ${FRAMEWORK_DIR}/scripts/wake.sh ${AGENT_DIR} >> logs/cycles/cron-wake.log 2>&1"

# Build all cron lines
CRON_LINES="$WAKE_LINE"

# Extra cron entries from agent.yaml
if [ "$EXTRA_CRON_COUNT" -gt 0 ] 2>/dev/null; then
  for i in $(seq 0 $((EXTRA_CRON_COUNT - 1))); do
    sched_var="EXTRA_CRON_${i}_SCHEDULE"
    cmd_var="EXTRA_CRON_${i}_COMMAND"
    log_var="EXTRA_CRON_${i}_LOG"
    schedule="${!sched_var}"; command="${!cmd_var}"; logfile="${!log_var}"

    EXTRA_LINE="${schedule} root ${NVM_SOURCE} cd ${AGENT_DIR} && ${command} >> ${logfile} 2>&1"
    CRON_LINES="$CRON_LINES
$EXTRA_LINE"
  done
fi

if [ "$ACTION" = "install" ]; then
  printf '%s\n' "$CRON_LINES" > "$AGENT_CRON_FILE"
  chmod 644 "$AGENT_CRON_FILE"
  echo "Installed cron jobs to $AGENT_CRON_FILE"
  echo ""
  echo "Contents:"
  cat "$AGENT_CRON_FILE"
else
  echo "Cron lines (install with: cron-setup.sh $AGENT_DIR install):"
  echo ""
  echo "$CRON_LINES"
fi
