#!/bin/bash
# scripts/telegram-respond.sh — Trigger a responsive cycle for a Telegram message.
# Usage: telegram-respond.sh <agent-dir> <message-text>
# Reads respond-prompt from agent.yaml. Uses framework commit.sh and notify.sh.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:?Usage: telegram-respond.sh <agent-dir> <message-text>}"
MESSAGE="${2:?Usage: telegram-respond.sh <agent-dir> <message-text>}"

cd "$AGENT_DIR"

# Ensure nvm/node/claude are on PATH
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Source .env
if [ -f "$AGENT_DIR/.env" ]; then
  set -a; . "$AGENT_DIR/.env"; set +a
fi

# Read agent config
eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml")"

# Mutex — wait up to 120s for lock (another cycle may be running)
exec 200>"$AGENT_LOCK_FILE"
flock -w 120 200 || { echo "Agent busy — cycle didn't complete in 2min"; exit 1; }

# Ensure conversation log exists
touch logs/conversation.jsonl

# Append human message to conversation buffer
echo "{\"ts\":\"$(date -Iseconds)\",\"role\":\"human\",\"text\":$(echo "$MESSAGE" | jq -Rs .)}" >> logs/conversation.jsonl

# Build recent conversation context (last 20 messages)
RECENT_CONVO=$(tail -20 logs/conversation.jsonl | jq -r '"[\(.role)] \(.text)"')

# Log cycle start
bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" responsive_cycle "Telegram message received"

echo "Running claude..."

# Build prompt: use respond-prompt from agent.yaml as the base, inject conversation context
# If no respond-prompt configured, use a sensible default
if [ -n "$RESPOND_PROMPT_FILE" ] && [ -f "$RESPOND_PROMPT_FILE" ]; then
  BASE_PROMPT="$(cat "$RESPOND_PROMPT_FILE")"
else
  BASE_PROMPT="You received a message from your human via Telegram. Follow the 'On Wake' instructions in CLAUDE.md to recall your state, then respond to the conversation."
fi

FULL_PROMPT="${BASE_PROMPT}

Recent conversation:
${RECENT_CONVO}

CRITICAL: Your ENTIRE output will be sent directly as a Telegram message. Do NOT narrate your actions, do NOT describe what you did or what tools you used. Just write the actual reply you want your human to read. Be concise, direct, and conversational — this is a chat, not a log.

If the message implies actions (reprioritize, new project, dig deeper on something), do them using tools, then confirm what you did in your response."

# Session continuation: reuse session if last human message was within 24 hours
SESSION_FILE="logs/telegram_session_id"
SESSION_ARGS=""

PREV_HUMAN_TS=$(grep '"role":"human"' logs/conversation.jsonl | tail -2 | head -1 | jq -r '.ts // ""')
if [ -n "$PREV_HUMAN_TS" ] && [ -f "$SESSION_FILE" ]; then
  PREV_EPOCH=$(date -d "$PREV_HUMAN_TS" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  AGE=$((NOW_EPOCH - PREV_EPOCH))
  SAVED_SESSION=$(cat "$SESSION_FILE")
  if [ "$AGE" -lt 86400 ] && [ "$AGE" -ge 0 ] && [ -n "$SAVED_SESSION" ]; then
    SESSION_ARGS="--resume $SAVED_SESSION"
    echo "Continuing session $SAVED_SESSION (last message ${AGE}s ago)"
  fi
fi

# Start a new session if not continuing
if [ -z "$SESSION_ARGS" ]; then
  NEW_SESSION=$(cat /proc/sys/kernel/random/uuid)
  SESSION_ARGS="--session-id $NEW_SESSION"
  echo "$NEW_SESSION" > "$SESSION_FILE"
  echo "Starting new session $NEW_SESSION"
fi

run_claude() {
  echo "$FULL_PROMPT" | claude --print \
    "$@" \
    2>>logs/respond_errors.log
}

set +e
if echo "$SESSION_ARGS" | grep -q -- '--resume'; then
  SAVED_SESSION=$(echo "$SESSION_ARGS" | awk '{print $2}')
  RESPONSE=$(run_claude --resume "$SAVED_SESSION")
  CLAUDE_EXIT=$?
  # Fallback: if --resume failed, start a fresh session
  if [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "Resume failed (exit $CLAUDE_EXIT), starting fresh session"
    NEW_SESSION=$(cat /proc/sys/kernel/random/uuid)
    echo "$NEW_SESSION" > "$SESSION_FILE"
    RESPONSE=$(run_claude --session-id "$NEW_SESSION")
    CLAUDE_EXIT=$?
  fi
else
  NEW_SESSION=$(echo "$SESSION_ARGS" | awk '{print $2}')
  RESPONSE=$(run_claude --session-id "$NEW_SESSION")
  CLAUDE_EXIT=$?
fi
set -e

if [ "$CLAUDE_EXIT" -ne 0 ]; then
  echo "Claude exited with code $CLAUDE_EXIT"
  bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" error \
    "Responsive cycle claude exited with code $CLAUDE_EXIT"
fi

# Guard against empty response
if [ -z "$RESPONSE" ]; then
  echo "Warning: claude returned empty response (exit code $CLAUDE_EXIT)"
  RESPONSE="Sorry, I wasn't able to process that. Please try again."
fi

echo "Sending response..."

# Dedup guard — skip if identical to the last agent message within 60 seconds
LAST_AGENT_MSG=$(grep '"role":"agent"' logs/conversation.jsonl | tail -1)
LAST_AGENT_TEXT=$(echo "$LAST_AGENT_MSG" | jq -r '.text // ""')
LAST_AGENT_TS=$(echo "$LAST_AGENT_MSG" | jq -r '.ts // ""')

DUPLICATE=false
if [ "$RESPONSE" = "$LAST_AGENT_TEXT" ] && [ -n "$LAST_AGENT_TS" ]; then
  LAST_EPOCH=$(date -d "$LAST_AGENT_TS" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  DIFF=$((NOW_EPOCH - LAST_EPOCH))
  if [ "$DIFF" -lt 60 ] && [ "$DIFF" -ge 0 ]; then
    DUPLICATE=true
    echo "Skipping duplicate response (same text within 60s)"
  fi
fi

# Append agent response to conversation buffer
echo "{\"ts\":\"$(date -Iseconds)\",\"role\":\"agent\",\"text\":$(echo "$RESPONSE" | jq -Rs .)}" >> logs/conversation.jsonl

if [ "$DUPLICATE" = "false" ]; then
  bash "$FRAMEWORK_DIR/scripts/notify.sh" "$RESPONSE"
fi

# Git commit
bash "$FRAMEWORK_DIR/scripts/commit.sh" "$AGENT_DIR" "responsive cycle (telegram)"

echo "Cycle complete."

bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" cycle_end "Responsive cycle complete"
