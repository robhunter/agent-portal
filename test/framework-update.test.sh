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

# ============================================================================
# Rollback behavior — real end-to-end runs of framework-update.sh (#247 F5)
# ============================================================================
# Unlike the stale-portal tests above (which exercise an extracted copy of the
# logic), these run the ACTUAL script against a throwaway git repo and assert
# its observable effects. The bug (#247 F5): when `git checkout <last-known-good>`
# fails, the old `|| { ... }` branch logged the error but execution CONTINUED —
# overwriting FRAMEWORK_COMMIT with the (un-checked-out) target and logging a
# success `rollback` event unconditionally. So a failed rollback reported the
# opposite of reality and poisoned framework-last-known-good.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RB_CLEANUP_DIRS=""
RB_CLEANUP_FILES=""

# Extend the existing EXIT trap to also clear rollback fixtures.
cleanup_rollback() {
  rm -rf $RB_CLEANUP_DIRS
  rm -f $RB_CLEANUP_FILES
}
trap 'cleanup; cleanup_rollback' EXIT

count_events() {  # $1=events.jsonl path, $2=event type
  [ -f "$1" ] || { echo 0; return; }
  local n
  n=$(grep -c "\"type\":\"$2\"" "$1" 2>/dev/null || true)
  echo "${n:-0}"
}

# run_rollback <last-known-good-value>
# Builds a self-contained framework dir (real helper scripts + node_modules,
# throwaway git history: commit "good" then commit "broken"=HEAD), sets agent.yaml's
# framework-last-known-good to $1, plants the cycle-failed marker, then runs the
# real framework-update.sh. Sets globals: RB_STDOUT, RB_EXIT, RB_HEAD,
# RB_SHA_GOOD, RB_SHA_BROKEN, RB_EVENTS, RB_REPORTED_COMMIT.
run_rollback() {
  local lkg="$1"
  local fw agent name
  fw=$(mktemp -d); agent=$(mktemp -d)
  name="fwtest-$$-$RANDOM"
  RB_CLEANUP_DIRS="$RB_CLEANUP_DIRS $fw $agent"
  RB_CLEANUP_FILES="$RB_CLEANUP_FILES /tmp/agent-${name}-cycle-failed /tmp/${name}-portal-commit /tmp/${name}-portal.pid /tmp/agent-${name}-wake-prompt.txt /tmp/agent-${name}-respond-prompt.txt"

  # Real helper scripts the script invokes (skip the heavy memory-venv); node_modules for js-yaml.
  mkdir -p "$fw/scripts"
  local s
  for s in framework-update.sh read-config.js log-event.sh read-harness-config.sh; do
    cp "$REPO_ROOT/scripts/$s" "$fw/scripts/$s"
  done
  ln -s "$REPO_ROOT/node_modules" "$fw/node_modules"

  # Throwaway git history. Only `version` is tracked; scripts/ + node_modules stay
  # untracked so `git checkout <sha>` never touches them.
  git -C "$fw" init -q
  git -C "$fw" config user.email "test@example.com"
  git -C "$fw" config user.name "test"
  echo good > "$fw/version"; git -C "$fw" add version; git -C "$fw" commit -qm good
  RB_SHA_GOOD=$(git -C "$fw" rev-parse HEAD)
  echo broken > "$fw/version"; git -C "$fw" add version; git -C "$fw" commit -qm broken
  RB_SHA_BROKEN=$(git -C "$fw" rev-parse HEAD)

  # Sentinel @GOOD@ means "use THIS fixture's good SHA" (only known after the commits exist).
  [ "$lkg" = "@GOOD@" ] && lkg="$RB_SHA_GOOD"
  printf 'name: %s\nframework-last-known-good: %s\n' "$name" "$lkg" > "$agent/agent.yaml"
  touch "/tmp/agent-${name}-cycle-failed"

  RB_EXIT=0
  RB_STDOUT=$(bash "$fw/scripts/framework-update.sh" "$fw" "$agent" 2>/dev/null) || RB_EXIT=$?
  RB_HEAD=$(git -C "$fw" rev-parse HEAD)
  RB_EVENTS="$agent/logs/events.jsonl"
  # Mirror wake.sh:211 — eval the script's stdout to recover the exported commit.
  FRAMEWORK_COMMIT=""
  eval "$RB_STDOUT"
  RB_REPORTED_COMMIT="$FRAMEWORK_COMMIT"
}

# --- Test 7: Successful rollback moves HEAD, reports the good SHA, logs success ---
echo "## Test 7: Successful rollback (checkout succeeds)"
run_rollback "@GOOD@"   # roll back to this fixture's own good SHA
assert_eq "$RB_SHA_GOOD" "$RB_HEAD" "HEAD is moved to last-known-good"
assert_eq "$RB_SHA_GOOD" "$RB_REPORTED_COMMIT" "exported FRAMEWORK_COMMIT is the good SHA"
assert_eq "1" "$(count_events "$RB_EVENTS" rollback)" "one rollback (success) event logged"
assert_eq "0" "$(count_events "$RB_EVENTS" error)" "no error event on success"
assert_eq "0" "$RB_EXIT" "script exits 0 on success"

# --- Test 8: FAILED rollback must NOT report success (the #247 F5 bug) ---
echo "## Test 8: Failed rollback (checkout of a non-existent commit)"
run_rollback "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"   # not a real object → checkout fails
assert_eq "$RB_SHA_BROKEN" "$RB_HEAD" "HEAD stays on the broken commit (checkout failed)"
assert_eq "$RB_SHA_BROKEN" "$RB_REPORTED_COMMIT" "exported FRAMEWORK_COMMIT is the REAL HEAD, not the failed target"
assert_eq "0" "$(count_events "$RB_EVENTS" rollback)" "NO success rollback event on failure"
assert_eq "1" "$(count_events "$RB_EVENTS" error)" "an error event is logged on failure"
assert_eq "0" "$RB_EXIT" "script still exits 0 (wake.sh consumes stdout via eval, not exit code)"

echo ""
echo "# Results: $PASS/$TESTS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
