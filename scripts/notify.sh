#!/bin/bash
# scripts/notify.sh — Send a Telegram message. Token-gated no-op.
# Usage: notify.sh <message>
#
# Expects TELEGRAM_TOKEN and TELEGRAM_CHAT_ID in environment (sourced by caller).
# If either is missing, logs the message to stderr and exits 0 (no-op).
set -e

TEXT="$1"

if [ -z "$TEXT" ]; then
  echo "Usage: notify.sh <message>"
  exit 1
fi

if [ -z "$TELEGRAM_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
  echo "Warning: TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set. Notification not sent." >&2
  echo "Message was: $TEXT" >&2
  exit 0
fi

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d text="${TEXT}"
