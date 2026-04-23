#!/bin/bash
# scripts/telegram_poll.sh — Lightweight Telegram long-polling daemon.
# Usage: telegram_poll.sh [agent-dir]
# Runs persistently in the container. No Claude Code dependency.
# Token-gated: exits if TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set.
#
# Multi-message burst handling (issue #219): when messages arrive in rapid
# succession (e.g. Telegram splits a long paste across the 4096-char limit),
# they are buffered and dispatched as a single responsive cycle after
# TELEGRAM_BURST_WINDOW_S (default 15s) of quiet. Messages more than that
# apart dispatch as separate cycles. The "Got it, thinking..." ACK is sent
# once per burst, on the first message received, so single-message UX
# matches the pre-#219 behavior.

FRAMEWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Burst state (kept in memory — lost on restart, which is fine because
# Telegram re-delivers unacknowledged updates when offset resets to 0).
BUFFER=""
LAST_MSG_EPOCH=0
BURST_ACKED=0
OFFSET=0

# Append a message to the burst buffer and mark the burst time.
# Sends the "Got it, thinking..." ACK on the first message of a burst only.
# Uses empty separator so content split by Telegram at the 4096-char limit
# reconstructs byte-for-byte.
buffer_message() {
  local text="$1"
  BUFFER="${BUFFER}${text}"
  LAST_MSG_EPOCH=$(date +%s)
  if [ "$BURST_ACKED" = "0" ] && [ -n "$API_BASE" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -sS --connect-timeout 10 -X POST "${API_BASE}/sendMessage" \
      -d chat_id="${TELEGRAM_CHAT_ID}" \
      -d text="Got it, thinking..." > /dev/null 2>&1 || true
    BURST_ACKED=1
  fi
}

# Returns 0 (success) if there is buffered content and the debounce window
# has elapsed since the last message; 1 otherwise.
should_dispatch() {
  [ -z "$BUFFER" ] && return 1
  local now elapsed
  now=$(date +%s)
  elapsed=$((now - LAST_MSG_EPOCH))
  [ "$elapsed" -ge "$TELEGRAM_BURST_WINDOW_S" ]
}

# Dispatch the current buffer as a single responsive cycle. Clears burst
# state first (so a crash mid-dispatch doesn't replay the same buffer when
# a new message arrives).
dispatch_buffer() {
  [ -z "$BUFFER" ] && return
  local msg="$BUFFER"
  BUFFER=""
  BURST_ACKED=0
  LAST_MSG_EPOCH=0
  bash "$FRAMEWORK_DIR/scripts/telegram-respond.sh" "$AGENT_DIR" "$msg" 2>&1 | while IFS= read -r line; do
    echo "$(date -Iseconds) [respond] $line"
  done
}

# Compute the getUpdates timeout. With an empty buffer, long-poll for 30s.
# With a buffered burst, poll only until the debounce window would elapse
# (so we can dispatch promptly if no new message arrives).
compute_timeout() {
  if [ -z "$BUFFER" ]; then
    echo 30
    return
  fi
  local now wait
  now=$(date +%s)
  wait=$((LAST_MSG_EPOCH + TELEGRAM_BURST_WINDOW_S - now))
  [ "$wait" -lt 0 ] && wait=0
  echo "$wait"
}

main() {
  AGENT_DIR="${1:-$(pwd)}"
  cd "$AGENT_DIR"

  # Ensure nvm/node/claude are on PATH
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

  # Source .env for credentials if not already in environment
  if [ -z "$TELEGRAM_TOKEN" ] && [ -f "$AGENT_DIR/.env" ]; then
    set -a; . "$AGENT_DIR/.env"; set +a
  fi

  if [ -z "$TELEGRAM_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    echo "$(date -Iseconds) FATAL: TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set"
    exit 1
  fi

  API_BASE="https://api.telegram.org/bot${TELEGRAM_TOKEN}"
  TELEGRAM_BURST_WINDOW_S="${TELEGRAM_BURST_WINDOW_S:-15}"

  echo "$(date -Iseconds) Telegram poller started (burst_window=${TELEGRAM_BURST_WINDOW_S}s)"

  while true; do
    local TIMEOUT
    TIMEOUT=$(compute_timeout)

    RESPONSE=$(curl -sS --connect-timeout 10 --max-time $((TIMEOUT + 5)) \
      "${API_BASE}/getUpdates?offset=${OFFSET}&timeout=${TIMEOUT}" 2>&1)
    CURL_EXIT=$?

    if [ "$CURL_EXIT" -ne 0 ]; then
      echo "$(date -Iseconds) ERROR: curl failed: $RESPONSE"
      sleep 5
      if should_dispatch; then
        dispatch_buffer
      fi
      continue
    fi

    OK=$(echo "$RESPONSE" | jq -r '.ok // false')
    if [ "$OK" != "true" ]; then
      echo "$(date -Iseconds) ERROR: Telegram API returned ok=false: $RESPONSE"
      sleep 5
      if should_dispatch; then
        dispatch_buffer
      fi
      continue
    fi

    UPDATES=$(echo "$RESPONSE" | jq -c '.result[]')

    while IFS= read -r UPDATE; do
      [ -z "$UPDATE" ] && continue

      UPDATE_ID=$(echo "$UPDATE" | jq -r '.update_id')
      CHAT_ID=$(echo "$UPDATE" | jq -r '.message.chat.id // empty')
      TEXT=$(echo "$UPDATE" | jq -r '.message.text // empty')

      OFFSET=$((UPDATE_ID + 1))

      if [ "$CHAT_ID" != "$TELEGRAM_CHAT_ID" ]; then
        echo "$(date -Iseconds) Ignoring message from chat $CHAT_ID"
        continue
      fi

      if [ -z "$TEXT" ]; then
        echo "$(date -Iseconds) Skipping non-text message"
        continue
      fi

      echo "$(date -Iseconds) Received message: ${TEXT:0:80}..."
      buffer_message "$TEXT"

    done <<< "$UPDATES"

    # After processing any updates from this poll, check whether the
    # debounce window has elapsed and we can dispatch.
    if should_dispatch; then
      dispatch_buffer
    fi
  done
}

# Only run the main loop when invoked directly. Sourcing the script (from
# tests) exposes the helper functions without starting the loop or cd'ing.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
