#!/bin/bash
# scripts/start.sh — Container entrypoint. Supervises background services.
# Usage: start.sh [agent-dir]
# Reads agent.yaml for port, cron config, etc. Expects .env at agent-dir root.

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:-$(pwd)}"
cd "$AGENT_DIR"

# Source nvm if available (may not be installed yet on first run)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Source .env
if [ -f "$AGENT_DIR/.env" ]; then
  set -a; . "$AGENT_DIR/.env"; set +a
fi

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"

LOG_FILE="logs/supervisor.log"
mkdir -p logs

log() {
  echo "$(date -Iseconds) [supervisor] $*" >> "$LOG_FILE"
  echo "$(date -Iseconds) [supervisor] $*"
}

log "Starting agent '$AGENT_NAME' (framework=$FRAMEWORK_DIR, agent=$AGENT_DIR)"

# Clean up stale PID files on startup
for pidfile in /tmp/${AGENT_NAME}-*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile" 2>/dev/null)
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    log "Removing stale PID file: $pidfile (pid $pid)"
    rm -f "$pidfile"
  fi
done

# supervise NAME COMMAND...
# Wraps a service in a restart loop with exponential backoff.
# Writes PID to /tmp/<agent-name>-<NAME>.pid.
supervise() {
  local name="$1"
  shift
  local pidfile="/tmp/${AGENT_NAME}-${name}.pid"
  local backoff=1
  local max_backoff=30
  local healthy_threshold=60

  (
    while true; do
      local start_ts=$(date +%s)
      log "Starting $name (backoff=${backoff}s)"

      "$@" &
      local child_pid=$!
      echo "$child_pid" > "$pidfile"

      wait "$child_pid" 2>/dev/null
      local exit_code=$?
      local runtime=$(( $(date +%s) - start_ts ))

      log "$name exited (code=$exit_code, runtime=${runtime}s)"
      rm -f "$pidfile"

      if [ "$runtime" -ge "$healthy_threshold" ]; then
        backoff=1
      else
        backoff=$(( backoff * 2 ))
        [ "$backoff" -gt "$max_backoff" ] && backoff=$max_backoff
      fi

      log "Restarting $name in ${backoff}s"
      sleep "$backoff"
    done
  ) &
  log "Supervisor loop for $name running (subshell PID $!)"
}

# Install cron jobs and start daemon
if command -v cron >/dev/null 2>&1; then
  bash "$FRAMEWORK_DIR/scripts/cron-setup.sh" "$AGENT_DIR" install \
    || log "Cron setup failed — will retry on next restart"
  cron
  log "Cron daemon started"
fi

# Pull latest framework code
log "Pulling latest framework..."
git -C "$FRAMEWORK_DIR" pull --ff-only 2>/dev/null || log "Framework pull failed (non-fatal)"

# Supervise portal server (portal code from framework, config from agent)
if command -v node >/dev/null 2>&1 && [ -f "$FRAMEWORK_DIR/index.js" ]; then
  log "Supervising portal server (port $AGENT_PORT)..."
  supervise "portal" node "$FRAMEWORK_DIR/index.js" "$AGENT_DIR/portal.config.json"
else
  log "Node not found or portal not available — skipping portal server"
fi

# Supervise Telegram poller if credentials are available
if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
  log "Supervising telegram-poller..."
  supervise "telegram-poller" bash "$FRAMEWORK_DIR/scripts/telegram_poll.sh" "$AGENT_DIR"
else
  log "TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set — skipping Telegram poller"
fi

# Run post-start hooks
bash "$FRAMEWORK_DIR/scripts/run-hooks.sh" "$FRAMEWORK_DIR" "$AGENT_DIR" post-start

log "Supervisor ready."

# Keep container alive
while true; do
  sleep 60
done
