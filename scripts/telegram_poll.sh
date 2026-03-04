#!/bin/bash
# scripts/telegram_poll.sh — Lightweight Telegram long-polling daemon.
# Usage: telegram_poll.sh [agent-dir]
# Runs persistently in the container. No Claude Code dependency.
# Token-gated: exits if TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set.

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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
OFFSET=0

echo "$(date -Iseconds) Telegram poller started"

while true; do
  # Long-poll with 30s timeout
  RESPONSE=$(curl -sS --connect-timeout 10 --max-time 35 "${API_BASE}/getUpdates?offset=${OFFSET}&timeout=30" 2>&1)

  if [ $? -ne 0 ]; then
    echo "$(date -Iseconds) ERROR: curl failed: $RESPONSE"
    sleep 5
    continue
  fi

  # Check API response is OK
  OK=$(echo "$RESPONSE" | jq -r '.ok // false')
  if [ "$OK" != "true" ]; then
    echo "$(date -Iseconds) ERROR: Telegram API returned ok=false: $RESPONSE"
    sleep 5
    continue
  fi

  # Process each update
  UPDATES=$(echo "$RESPONSE" | jq -c '.result[]')

  while IFS= read -r UPDATE; do
    [ -z "$UPDATE" ] && continue

    UPDATE_ID=$(echo "$UPDATE" | jq -r '.update_id')
    CHAT_ID=$(echo "$UPDATE" | jq -r '.message.chat.id // empty')
    TEXT=$(echo "$UPDATE" | jq -r '.message.text // empty')

    # Advance offset past this update
    OFFSET=$((UPDATE_ID + 1))

    # Only process messages from our chat
    if [ "$CHAT_ID" != "$TELEGRAM_CHAT_ID" ]; then
      echo "$(date -Iseconds) Ignoring message from chat $CHAT_ID"
      continue
    fi

    # Skip empty messages (photos, stickers, etc.)
    if [ -z "$TEXT" ]; then
      echo "$(date -Iseconds) Skipping non-text message"
      continue
    fi

    echo "$(date -Iseconds) Received message: ${TEXT:0:80}..."

    # ACK immediately so the human knows the message was received
    curl -sS --connect-timeout 10 -X POST "${API_BASE}/sendMessage" \
      -d chat_id="${TELEGRAM_CHAT_ID}" \
      -d text="Got it, thinking..." > /dev/null 2>&1

    # Trigger responsive cycle via framework's telegram-respond.sh
    bash "$FRAMEWORK_DIR/scripts/telegram-respond.sh" "$AGENT_DIR" "$TEXT" 2>&1 | while IFS= read -r line; do
      echo "$(date -Iseconds) [respond] $line"
    done

  done <<< "$UPDATES"
done
