#!/bin/bash
# Test session continuation logic in telegram-respond.sh
# Tests the decision logic for --resume vs --session-id without calling claude
set -e

PASS=0
FAIL=0
TESTS=0

assert_eq() {
  TESTS=$((TESTS + 1))
  if [ "$1" = "$2" ]; then
    PASS=$((PASS + 1))
    echo "  ok - $3"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $3 (expected '$1', got '$2')"
  fi
}

assert_contains() {
  TESTS=$((TESTS + 1))
  if echo "$2" | grep -qF -- "$1"; then
    PASS=$((PASS + 1))
    echo "  ok - $3"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $3 (expected '$2' to contain '$1')"
  fi
}

echo "# telegram session continuation tests"

# Setup temp dir
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/logs"
touch "$TMPDIR/logs/conversation.jsonl"

# --- Test 1: No previous messages → new session ---
echo "## Test 1: First message starts new session"
SESSION_FILE="$TMPDIR/logs/telegram_session_id"
SESSION_ARGS=""

PREV_HUMAN_TS=$(grep '"role":"human"' "$TMPDIR/logs/conversation.jsonl" | tail -2 | head -1 | jq -r '.ts // ""' 2>/dev/null || echo "")
if [ -n "$PREV_HUMAN_TS" ] && [ -f "$SESSION_FILE" ]; then
  SESSION_ARGS="--resume test"
fi
if [ -z "$SESSION_ARGS" ]; then
  SESSION_ARGS="--session-id new"
fi
assert_contains "--session-id" "$SESSION_ARGS" "new session when no history"

# --- Test 2: Recent message (5 min ago) + session file → resume ---
echo "## Test 2: Recent message continues session"
FIVE_MIN_AGO=$(date -d "5 minutes ago" -Iseconds)
echo "{\"ts\":\"$FIVE_MIN_AGO\",\"role\":\"human\",\"text\":\"hello\"}" > "$TMPDIR/logs/conversation.jsonl"
echo "{\"ts\":\"$FIVE_MIN_AGO\",\"role\":\"agent\",\"text\":\"hi\"}" >> "$TMPDIR/logs/conversation.jsonl"
echo "{\"ts\":\"$(date -Iseconds)\",\"role\":\"human\",\"text\":\"how are you\"}" >> "$TMPDIR/logs/conversation.jsonl"
echo "test-session-id-123" > "$SESSION_FILE"

SESSION_ARGS=""
PREV_HUMAN_TS=$(grep '"role":"human"' "$TMPDIR/logs/conversation.jsonl" | tail -2 | head -1 | jq -r '.ts // ""')
if [ -n "$PREV_HUMAN_TS" ] && [ -f "$SESSION_FILE" ]; then
  PREV_EPOCH=$(date -d "$PREV_HUMAN_TS" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  AGE=$((NOW_EPOCH - PREV_EPOCH))
  SAVED_SESSION=$(cat "$SESSION_FILE")
  if [ "$AGE" -lt 86400 ] && [ "$AGE" -ge 0 ] && [ -n "$SAVED_SESSION" ]; then
    SESSION_ARGS="--resume $SAVED_SESSION"
  fi
fi
if [ -z "$SESSION_ARGS" ]; then
  SESSION_ARGS="--session-id new"
fi
assert_contains "--resume" "$SESSION_ARGS" "resumes when last message is recent"
assert_contains "test-session-id-123" "$SESSION_ARGS" "uses saved session ID"

# --- Test 3: Old message (25 hours ago) → new session ---
echo "## Test 3: Old message starts new session"
OLD_TS=$(date -d "25 hours ago" -Iseconds)
echo "{\"ts\":\"$OLD_TS\",\"role\":\"human\",\"text\":\"hello\"}" > "$TMPDIR/logs/conversation.jsonl"
echo "{\"ts\":\"$(date -Iseconds)\",\"role\":\"human\",\"text\":\"hi again\"}" >> "$TMPDIR/logs/conversation.jsonl"

SESSION_ARGS=""
PREV_HUMAN_TS=$(grep '"role":"human"' "$TMPDIR/logs/conversation.jsonl" | tail -2 | head -1 | jq -r '.ts // ""')
if [ -n "$PREV_HUMAN_TS" ] && [ -f "$SESSION_FILE" ]; then
  PREV_EPOCH=$(date -d "$PREV_HUMAN_TS" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  AGE=$((NOW_EPOCH - PREV_EPOCH))
  SAVED_SESSION=$(cat "$SESSION_FILE")
  if [ "$AGE" -lt 86400 ] && [ "$AGE" -ge 0 ] && [ -n "$SAVED_SESSION" ]; then
    SESSION_ARGS="--resume $SAVED_SESSION"
  fi
fi
if [ -z "$SESSION_ARGS" ]; then
  SESSION_ARGS="--session-id new"
fi
assert_contains "--session-id" "$SESSION_ARGS" "new session when last message > 24h"

# --- Test 4: Recent message but no session file → new session ---
echo "## Test 4: Recent message but missing session file"
RECENT_TS=$(date -d "1 minute ago" -Iseconds)
echo "{\"ts\":\"$RECENT_TS\",\"role\":\"human\",\"text\":\"hello\"}" > "$TMPDIR/logs/conversation.jsonl"
echo "{\"ts\":\"$(date -Iseconds)\",\"role\":\"human\",\"text\":\"again\"}" >> "$TMPDIR/logs/conversation.jsonl"
rm -f "$SESSION_FILE"

SESSION_ARGS=""
PREV_HUMAN_TS=$(grep '"role":"human"' "$TMPDIR/logs/conversation.jsonl" | tail -2 | head -1 | jq -r '.ts // ""')
if [ -n "$PREV_HUMAN_TS" ] && [ -f "$SESSION_FILE" ]; then
  SESSION_ARGS="--resume test"
fi
if [ -z "$SESSION_ARGS" ]; then
  SESSION_ARGS="--session-id new"
fi
assert_contains "--session-id" "$SESSION_ARGS" "new session when no session file"

# Cleanup
rm -rf "$TMPDIR"

echo ""
echo "# Results: $PASS/$TESTS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
