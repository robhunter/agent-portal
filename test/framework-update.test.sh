#!/bin/bash
# Test stale portal detection logic in framework-update.sh
# Tests the commit-tracking mechanism that detects local merges
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

echo "# framework-update stale portal detection tests"

# Setup temp dir simulating agent environment
TMPDIR=$(mktemp -d)
AGENT_NAME="test-agent-$$"
PORTAL_COMMIT_FILE="/tmp/${AGENT_NAME}-portal-commit"
PORTAL_PID_FILE="/tmp/${AGENT_NAME}-portal.pid"
KILL_LOG="$TMPDIR/kill.log"

# Clean up on exit
cleanup() {
  rm -rf "$TMPDIR"
  rm -f "$PORTAL_COMMIT_FILE" "$PORTAL_PID_FILE"
}
trap cleanup EXIT

# Helper: simulate the stale portal detection logic (extracted from framework-update.sh)
check_stale_portal() {
  local current_commit="$1"

  if [ -f "$PORTAL_COMMIT_FILE" ]; then
    local running_commit
    running_commit=$(cat "$PORTAL_COMMIT_FILE" 2>/dev/null || echo "unknown")
    if [ "$running_commit" != "$current_commit" ] && [ "$running_commit" != "unknown" ]; then
      echo "would-restart" >> "$KILL_LOG"
    fi
  fi
  echo "$current_commit" > "$PORTAL_COMMIT_FILE"
}

# --- Test 1: First run — no commit file exists, no restart ---
echo "## Test 1: First run stores commit without restart"
rm -f "$PORTAL_COMMIT_FILE" "$KILL_LOG"
check_stale_portal "abc123"
assert_eq "abc123" "$(cat "$PORTAL_COMMIT_FILE")" "stores initial commit"
assert_eq "" "$(cat "$KILL_LOG" 2>/dev/null)" "no restart on first run"

# --- Test 2: Same commit — no restart ---
echo "## Test 2: Same commit does not restart"
rm -f "$KILL_LOG"
check_stale_portal "abc123"
assert_eq "abc123" "$(cat "$PORTAL_COMMIT_FILE")" "commit unchanged"
assert_eq "" "$(cat "$KILL_LOG" 2>/dev/null)" "no restart when commit matches"

# --- Test 3: Different commit (local merge) — restart ---
echo "## Test 3: Different commit triggers restart"
rm -f "$KILL_LOG"
check_stale_portal "def456"
assert_eq "def456" "$(cat "$PORTAL_COMMIT_FILE")" "stores new commit"
assert_eq "would-restart" "$(cat "$KILL_LOG" 2>/dev/null)" "restart triggered on commit change"

# --- Test 4: Unknown stored commit — no restart ---
echo "## Test 4: Unknown stored commit does not restart"
rm -f "$KILL_LOG"
echo "unknown" > "$PORTAL_COMMIT_FILE"
check_stale_portal "ghi789"
assert_eq "ghi789" "$(cat "$PORTAL_COMMIT_FILE")" "stores new commit"
assert_eq "" "$(cat "$KILL_LOG" 2>/dev/null)" "no restart when stored is unknown"

# --- Test 5: Multiple cycles with same commit — no restart ---
echo "## Test 5: Multiple stable cycles"
rm -f "$KILL_LOG" "$PORTAL_COMMIT_FILE"
check_stale_portal "stable1"
check_stale_portal "stable1"
check_stale_portal "stable1"
assert_eq "" "$(cat "$KILL_LOG" 2>/dev/null)" "no restarts across stable cycles"

# --- Test 6: Commit changes then stabilizes ---
echo "## Test 6: One restart then stable"
rm -f "$KILL_LOG"
echo "old-commit" > "$PORTAL_COMMIT_FILE"
check_stale_portal "new-commit"
FIRST_RESULT=$(cat "$KILL_LOG" 2>/dev/null)
rm -f "$KILL_LOG"
check_stale_portal "new-commit"
SECOND_RESULT=$(cat "$KILL_LOG" 2>/dev/null || true)
assert_eq "would-restart" "$FIRST_RESULT" "restart on first change"
assert_eq "" "$SECOND_RESULT" "no restart after stabilizing"

echo ""
echo "# Results: $PASS/$TESTS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
