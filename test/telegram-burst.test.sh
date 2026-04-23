#!/bin/bash
# Test multi-message burst buffering in telegram_poll.sh (issue #219).
# Sources the poll script to test helper functions in isolation, stubbing
# curl and telegram-respond.sh so no real network or agent invocation occurs.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

assert_not_eq() {
  TESTS=$((TESTS + 1))
  if [ "$1" != "$2" ]; then
    PASS=$((PASS + 1))
    echo "  ok - $3"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $3 (expected values to differ, both were '$1')"
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

assert_true() {
  TESTS=$((TESTS + 1))
  if [ "$1" = "0" ]; then
    PASS=$((PASS + 1))
    echo "  ok - $2"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $2 (expected exit 0, got $1)"
  fi
}

assert_false() {
  TESTS=$((TESTS + 1))
  if [ "$1" != "0" ]; then
    PASS=$((PASS + 1))
    echo "  ok - $2"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $2 (expected non-zero exit, got 0)"
  fi
}

echo "# telegram burst-buffer tests"

# Temp dir for agent + fake framework dir
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/agent/logs"
mkdir -p "$TMPDIR/fake-framework/scripts"

# Stub for telegram-respond.sh — just logs args to a file
cat > "$TMPDIR/fake-framework/scripts/telegram-respond.sh" <<'STUB'
#!/bin/bash
echo "RESPOND_CALLED agent=$1 msg_len=${#2}" >> "$RESPOND_LOG"
echo "RESPOND_MSG=$2" >> "$RESPOND_LOG"
STUB
chmod +x "$TMPDIR/fake-framework/scripts/telegram-respond.sh"

export RESPOND_LOG="$TMPDIR/respond.log"
export CURL_LOG="$TMPDIR/curl.log"
: > "$RESPOND_LOG"
: > "$CURL_LOG"

# Source the real script. Functions are defined at top level; main is
# guarded by BASH_SOURCE == $0 and won't run when sourced.
# shellcheck disable=SC1090
source "$REPO_ROOT/scripts/telegram_poll.sh"

# Override FRAMEWORK_DIR after sourcing so the stub is picked up
FRAMEWORK_DIR="$TMPDIR/fake-framework"
AGENT_DIR="$TMPDIR/agent"

# Stub curl as a function (shadows the real curl in our test shell).
# Records each invocation to $CURL_LOG.
curl() {
  echo "CURL $*" >> "$CURL_LOG"
  return 0
}

# Set env needed for ACK path inside buffer_message
API_BASE="https://api.telegram.org/botFAKETOKEN"
TELEGRAM_CHAT_ID="12345"
TELEGRAM_BURST_WINDOW_S=2

# --- Test 1: buffer_message concatenates with empty separator ---
echo "## Test 1: buffer concatenation preserves content byte-for-byte"
BUFFER=""
BURST_ACKED=0
LAST_MSG_EPOCH=0
: > "$CURL_LOG"

buffer_message "hello "
buffer_message "world"

assert_eq "hello world" "$BUFFER" "two messages concatenate with empty separator"
assert_eq "1" "$BURST_ACKED" "BURST_ACKED set after first message"

# --- Test 2: ACK is sent once per burst, not per message ---
echo "## Test 2: one ACK per burst, not one per message"
BUFFER=""
BURST_ACKED=0
: > "$CURL_LOG"

buffer_message "msg1"
buffer_message "msg2"
buffer_message "msg3"

ACK_COUNT=$(grep -c 'sendMessage' "$CURL_LOG" 2>/dev/null || echo 0)
assert_eq "1" "$ACK_COUNT" "only one sendMessage ACK for 3 messages in same burst"

# --- Test 3: should_dispatch returns false when buffer is empty ---
echo "## Test 3: should_dispatch on empty buffer"
BUFFER=""
LAST_MSG_EPOCH=0
set +e
should_dispatch
RC=$?
set -e
assert_false "$RC" "should_dispatch returns non-zero when buffer empty"

# --- Test 4: should_dispatch returns false when elapsed < window ---
echo "## Test 4: should_dispatch within debounce window"
BUFFER="content"
LAST_MSG_EPOCH=$(date +%s)
set +e
should_dispatch
RC=$?
set -e
assert_false "$RC" "should_dispatch returns non-zero when elapsed < burst_window"

# --- Test 5: should_dispatch returns true when elapsed >= window ---
echo "## Test 5: should_dispatch after debounce elapsed"
BUFFER="content"
LAST_MSG_EPOCH=$(($(date +%s) - 5))  # 5s ago, window is 2s
set +e
should_dispatch
RC=$?
set -e
assert_true "$RC" "should_dispatch returns zero when elapsed >= burst_window"

# --- Test 6: compute_timeout returns 30 when buffer empty ---
echo "## Test 6: compute_timeout with empty buffer"
BUFFER=""
LAST_MSG_EPOCH=0
TO=$(compute_timeout)
assert_eq "30" "$TO" "timeout is 30s when no buffered burst"

# --- Test 7: compute_timeout returns remaining window when burst in progress ---
echo "## Test 7: compute_timeout within burst"
BUFFER="content"
TELEGRAM_BURST_WINDOW_S=10
LAST_MSG_EPOCH=$(date +%s)  # just now
TO=$(compute_timeout)
# Should be somewhere in [9, 10] depending on whether the clock ticked.
if [ "$TO" -ge 9 ] && [ "$TO" -le 10 ]; then
  PASS=$((PASS + 1)); TESTS=$((TESTS + 1))
  echo "  ok - timeout is remaining window when burst in progress (got $TO)"
else
  FAIL=$((FAIL + 1)); TESTS=$((TESTS + 1))
  echo "  FAIL - timeout not in [9,10] when burst just started (got $TO)"
fi

# --- Test 8: compute_timeout returns 0 when window already elapsed ---
echo "## Test 8: compute_timeout past the window"
BUFFER="content"
TELEGRAM_BURST_WINDOW_S=2
LAST_MSG_EPOCH=$(($(date +%s) - 5))
TO=$(compute_timeout)
assert_eq "0" "$TO" "timeout clamped to 0 when burst window already elapsed"

# --- Test 9: dispatch_buffer invokes telegram-respond.sh with stitched content ---
echo "## Test 9: dispatch_buffer invokes respond.sh with stitched content"
BUFFER="part1part2part3"
BURST_ACKED=1
LAST_MSG_EPOCH=$(date +%s)
: > "$RESPOND_LOG"

dispatch_buffer

assert_eq "" "$BUFFER" "buffer cleared after dispatch"
assert_eq "0" "$BURST_ACKED" "BURST_ACKED reset after dispatch"
assert_eq "0" "$LAST_MSG_EPOCH" "LAST_MSG_EPOCH reset after dispatch"
RESPOND_CONTENT=$(cat "$RESPOND_LOG")
assert_contains "RESPOND_CALLED" "$RESPOND_CONTENT" "telegram-respond.sh was invoked"
assert_contains "RESPOND_MSG=part1part2part3" "$RESPOND_CONTENT" "respond.sh received stitched content"

# --- Test 10: dispatch_buffer is a no-op on empty buffer ---
echo "## Test 10: dispatch_buffer no-op on empty buffer"
BUFFER=""
: > "$RESPOND_LOG"

dispatch_buffer

RESPOND_LINES=$(wc -l < "$RESPOND_LOG" | tr -d ' ')
assert_eq "0" "$RESPOND_LINES" "no respond.sh invocation when buffer empty"

# --- Test 11: full burst cycle — 3 rapid messages → one dispatch ---
echo "## Test 11: full burst cycle — 3 messages within window → single dispatch"
BUFFER=""
BURST_ACKED=0
LAST_MSG_EPOCH=0
TELEGRAM_BURST_WINDOW_S=2
: > "$RESPOND_LOG"
: > "$CURL_LOG"

buffer_message "A"
buffer_message "B"
buffer_message "C"

# Within window: should_dispatch should be false
set +e
should_dispatch
RC=$?
set -e
assert_false "$RC" "still waiting (within debounce window)"

# Wait for window to pass
sleep 3

set +e
should_dispatch
RC=$?
set -e
assert_true "$RC" "ready to dispatch after window elapsed"

dispatch_buffer

RESPOND_CONTENT=$(cat "$RESPOND_LOG")
assert_contains "RESPOND_MSG=ABC" "$RESPOND_CONTENT" "3 rapid messages stitched into ABC"

ACK_COUNT=$(grep -c 'sendMessage' "$CURL_LOG" 2>/dev/null || echo 0)
assert_eq "1" "$ACK_COUNT" "only 1 ACK sent for the burst of 3"

# --- Test 12: messages arriving after debounce → separate bursts ---
echo "## Test 12: messages > window apart → separate bursts"
BUFFER=""
BURST_ACKED=0
LAST_MSG_EPOCH=0
TELEGRAM_BURST_WINDOW_S=1
: > "$RESPOND_LOG"
: > "$CURL_LOG"

buffer_message "first"
sleep 2  # exceed window

set +e
should_dispatch
RC=$?
set -e
assert_true "$RC" "first message ready to dispatch"
dispatch_buffer
RESPOND_CONTENT1=$(cat "$RESPOND_LOG")
: > "$RESPOND_LOG"

buffer_message "second"
sleep 2

set +e
should_dispatch
RC=$?
set -e
assert_true "$RC" "second message ready to dispatch"
dispatch_buffer
RESPOND_CONTENT2=$(cat "$RESPOND_LOG")

assert_contains "RESPOND_MSG=first" "$RESPOND_CONTENT1" "first burst dispatched with 'first'"
assert_contains "RESPOND_MSG=second" "$RESPOND_CONTENT2" "second burst dispatched with 'second'"

ACK_COUNT=$(grep -c 'sendMessage' "$CURL_LOG" 2>/dev/null || echo 0)
assert_eq "2" "$ACK_COUNT" "2 ACKs, one per burst"

# Cleanup
rm -rf "$TMPDIR"

echo ""
echo "# Results: $PASS/$TESTS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
