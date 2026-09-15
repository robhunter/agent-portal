#!/bin/bash
# test/cycle-lock.test.sh — acquire_cycle_lock must never hand a second cycle a
# lock the first one is holding.
#
# Regression test for issue #299: wake.sh identified the holder with `fuser`,
# which is not installed, so every contended wake took the "orphaned lock"
# branch, unlinked the file the live holder's flock sits on, and started a
# second cycle beside the first.
#
# Run directly or via `npm test` (the test/*.test.sh loop).

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }

echo "# cycle-lock.sh"

if ! command -v flock >/dev/null 2>&1; then
  echo "  SKIP - flock not available (non-Linux host); the cycle lock is Linux-only"
  exit 0
fi

. "$SCRIPT_DIR/scripts/cycle-lock.sh"

TMP=$(mktemp -d)
HOLDERS="$TMP/holders"
cleanup() {
  [ -f "$HOLDERS" ] && while read -r pid; do kill -9 "$pid" 2>/dev/null; done < "$HOLDERS"
  rm -rf "$TMP"
}
trap cleanup EXIT

# A stand-in for a running cycle: holds the flock on its own fd and writes its
# PID into the file the way wake.sh does after acquiring.
start_holder() {
  local lock_file="$1"
  bash -c 'exec 201>"$1"; flock -n 201 || exit 1; echo $$ > "$1"; sleep 120' _ "$lock_file" >/dev/null 2>&1 &
  local pid=$!
  echo "$pid" >> "$HOLDERS"
  local waited=0
  while [ "$(cat "$lock_file" 2>/dev/null)" != "$pid" ] && [ "$waited" -lt 50 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  echo "$pid"
}

inode_of() { stat -c %i "$1" 2>/dev/null; }

release() { flock -u 200 2>/dev/null; exec 200>&- 2>/dev/null; }

# ── an uncontended lock is acquired ──
LOCK="$TMP/free.lock"
acquire_cycle_lock "$LOCK" 14400
check "acquires a lock nobody holds" "$?" "0"
release

# ── a live holder is left alone ──
LOCK="$TMP/live.lock"
HOLDER=$(start_holder "$LOCK")
BEFORE=$(inode_of "$LOCK")
STATUS=0
acquire_cycle_lock "$LOCK" 14400 || STATUS=$?
check "skips while another cycle holds the lock" "$STATUS" "1"
check "reports which PID holds it" "$LOCK_HOLDER_PID" "$HOLDER"
check "leaves the lock file on the same inode" "$(inode_of "$LOCK")" "$BEFORE"
kill -0 "$HOLDER" 2>/dev/null && ok "leaves the holder running" || bad "leaves the holder running"
release
kill -9 "$HOLDER" 2>/dev/null

# ── a holder whose PID we cannot read is still a holder ──
LOCK="$TMP/anonymous.lock"
HOLDER=$(start_holder "$LOCK")
: > "$LOCK"
BEFORE=$(inode_of "$LOCK")
STATUS=0
acquire_cycle_lock "$LOCK" 14400 || STATUS=$?
check "skips when the lock file names no PID" "$STATUS" "1"
check "does not unlink the file it could not identify" "$(inode_of "$LOCK")" "$BEFORE"
kill -0 "$HOLDER" 2>/dev/null && ok "leaves an unidentified holder running" || bad "leaves an unidentified holder running"
release
kill -9 "$HOLDER" 2>/dev/null

# ── a holder past the staleness threshold is killed ──
LOCK="$TMP/stale.lock"
HOLDER=$(start_holder "$LOCK")
sleep 1
STATUS=0
acquire_cycle_lock "$LOCK" 0 || STATUS=$?
check "takes the lock from a holder older than the threshold" "$STATUS" "2"
check "names the holder it killed" "$LOCK_HOLDER_PID" "$HOLDER"
kill -0 "$HOLDER" 2>/dev/null && bad "the stale holder is gone" || ok "the stale holder is gone"
release

# ── a dead holder's lock is free without anyone breaking it ──
LOCK="$TMP/dead.lock"
HOLDER=$(start_holder "$LOCK")
kill -9 "$HOLDER" 2>/dev/null
wait "$HOLDER" 2>/dev/null
STATUS=0
acquire_cycle_lock "$LOCK" 14400 || STATUS=$?
check "acquires a lock the kernel released when its holder died" "$STATUS" "0"
release

# ── the caller can hold it against a second attempt ──
LOCK="$TMP/mine.lock"
acquire_cycle_lock "$LOCK" 14400
echo $$ > "$LOCK"
CONTENDER=$(bash -c 'exec 202>"$1"; flock -n 202 && echo free || echo held' _ "$LOCK")
check "keeps the lock held for the cycle that took it" "$CONTENDER" "held"
release

echo "# $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
