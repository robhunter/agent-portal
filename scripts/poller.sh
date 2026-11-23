#!/bin/bash
# scripts/poller.sh — wake the agent when its work changes, not on a timer.
# Usage: poller.sh [agent-dir]
#
# Supervised by start.sh when agent.yaml sets `poll.command`. Every
# `poll.interval-seconds` it runs that command in the agent dir. The command
# prints what is due, one key per line, and exits 0; an empty output means
# nothing is due. Each key should change whenever the work it names changes
# (e.g. carry a head commit or a verdict timestamp), because a new set of keys
# is what starts a cycle.
#
# A cycle starts when the lock is free, something is due, and either the due set
# differs from the one the last poller-started cycle saw, or that cycle ended
# `poll.retry-seconds` ago with the same set still due (a harness error, a usage
# limit). The lock is only looked at here, never taken: wake.sh takes it, and
# only a free lock reaches wake.sh, so its stale-lock kill never fires on a long
# cycle because of a poll.
#
# The cron switch governs this too: with the wake line commented out, the poller
# does nothing. Cron keeps running on its own schedule as the backstop — idle
# compaction, and a wake when the poll command itself is failing.
#
# Each tick writes <DATA_DIR>/logs/poller-status.json for the portal. Errors go
# to events.jsonl once each time they change, not every tick.

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:-$(pwd)}"
cd "$AGENT_DIR" || exit 1

for _f in /etc/profile.d/sandcat-*.sh; do [ -r "$_f" ] && . "$_f"; done
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"
if [ -f "$AGENT_DIR/portal.config.json" ]; then
  eval "$(bash "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$AGENT_DIR" 2>/dev/null | grep '^export DATA_DIR=')"
fi
DATA_DIR="${DATA_DIR:-.}"
[ -n "$AGENT_TIMEZONE" ] && export TZ="$AGENT_TIMEZONE"

if [ -z "$AGENT_POLL_COMMAND" ]; then
  echo "poller: agent.yaml has no poll.command — nothing to do" >&2
  exit 0
fi

INTERVAL="${AGENT_POLL_INTERVAL:-60}"
RETRY="${AGENT_POLL_RETRY:-1800}"
CMD_TIMEOUT="${AGENT_POLL_TIMEOUT:-300}"
# Tests swap these; in production the wake is the same one cron runs.
WAKE_CMD="${POLLER_WAKE_CMD:-bash $(printf '%q' "$FRAMEWORK_DIR/scripts/wake.sh") $(printf '%q' "$AGENT_DIR")}"
MAX_TICKS="${POLLER_MAX_TICKS:-0}"
STARTING_MARKER_TTL=30

mkdir -p "$DATA_DIR/logs/cycles"
STATUS_FILE="$DATA_DIR/logs/poller-status.json"
ERR_FILE="$(mktemp -t poller-err.XXXXXX)"
OUT_FILE="$(mktemp -t poller-out.XXXXXX)"
trap 'rm -f "$ERR_FILE" "$OUT_FILE"' EXIT

event() { bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" "$1" "$2" >/dev/null 2>&1 || true; }

# Same test as lib/cron.js: an uncommented wake.sh line means the agent is on.
enabled() {
  [ -n "$AGENT_CRON_FILE" ] || return 0
  grep -v '^[[:space:]]*#' "$AGENT_CRON_FILE" 2>/dev/null | grep -q 'wake.sh'
}

# Running = the flock is held, or the portal's Run Cycle just wrote its
# .starting marker and wake.sh has not taken the lock yet.
cycle_running() {
  [ -n "$AGENT_LOCK_FILE" ] || return 1
  local marker="${AGENT_LOCK_FILE}.starting"
  if [ -f "$marker" ] && [ $(( $(date +%s) - $(stat -c %Y "$marker" 2>/dev/null || echo 0) )) -lt "$STARTING_MARKER_TTL" ]; then
    return 0
  fi
  [ -e "$AGENT_LOCK_FILE" ] || return 1
  ! flock -n "$AGENT_LOCK_FILE" true 2>/dev/null
}

write_status() {
  POLL_ENABLED="$1" POLL_OK="$2" POLL_ERROR="$3" POLL_DUE="$4" POLL_RUNNING="$5" \
  POLL_LAUNCH="$last_launch" POLL_LAUNCH_DUE="$last_due" POLL_INTERVAL="$INTERVAL" \
  POLL_RETRY="$RETRY" POLL_STATUS_FILE="$STATUS_FILE" python3 - <<'PY' 2>/dev/null || true
import json, os, time
from datetime import datetime
e = os.environ
def ts(s):
    return datetime.fromtimestamp(s).astimezone().isoformat(timespec='seconds') if s else None
due = [k for k in e['POLL_DUE'].split('\n') if k]
launch = int(e['POLL_LAUNCH'] or 0)
doc = {
    'pid': os.getppid(),
    'checkedAt': ts(time.time()),
    'enabled': e['POLL_ENABLED'] == '1',
    'ok': e['POLL_OK'] == '1',
    'error': e['POLL_ERROR'] or None,
    'due': due,
    'dueCount': len(due),
    'cycleRunning': e['POLL_RUNNING'] == '1',
    'lastLaunchAt': ts(launch),
    'lastLaunchDue': [k for k in e['POLL_LAUNCH_DUE'].split('\n') if k],
    'intervalSeconds': int(e['POLL_INTERVAL']),
    'retrySeconds': int(e['POLL_RETRY']),
}
path = e['POLL_STATUS_FILE']
with open(path + '.tmp', 'w') as f:
    json.dump(doc, f)
os.replace(path + '.tmp', path)
PY
}

last_err=""
last_due=""
last_launch=0
ticks=0
while true; do
  if enabled; then
    err=""; due=""; running=0
    cycle_running && running=1
    if timeout "$CMD_TIMEOUT" bash -c "$AGENT_POLL_COMMAND" >"$OUT_FILE" 2>"$ERR_FILE"; then
      due="$(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$OUT_FILE" | grep -v '^$' | LC_ALL=C sort -u)"
      now="$(date +%s)"
      if [ "$running" = 0 ] && [ -n "$due" ] && \
         { [ "$due" != "$last_due" ] || [ $((now - last_launch)) -ge "$RETRY" ]; }; then
        nohup bash -c "$WAKE_CMD" >> "$DATA_DIR/logs/cycles/cron-wake.log" 2>&1 &
        disown
        last_due="$due"
        last_launch="$now"
        running=1
        event work "Poller started a cycle: $(printf '%s\n' "$due" | wc -l | tr -d ' ') due ($(printf '%s\n' "$due" | head -n 5 | tr '\n' ' ' | cut -c1-200))"
      fi
    else
      rc=$?
      why="$(tail -n 1 "$ERR_FILE" | cut -c1-200)"
      [ "$rc" = 124 ] && why="timed out after ${CMD_TIMEOUT}s"
      err="poll command failed (rc=$rc): ${why:-no stderr}"
    fi
    write_status 1 "$([ -z "$err" ] && echo 1 || echo 0)" "$err" "$due" "$running"
    if [ "$err" != "$last_err" ]; then
      if [ -n "$err" ]; then event error "Poller: $err"; else event work "Poller recovered"; fi
      last_err="$err"
    fi
  else
    write_status 0 1 "" "" "$(cycle_running && echo 1 || echo 0)"
  fi
  ticks=$((ticks + 1))
  [ "$MAX_TICKS" -gt 0 ] && [ "$ticks" -ge "$MAX_TICKS" ] && exit 0
  sleep "$INTERVAL"
done
