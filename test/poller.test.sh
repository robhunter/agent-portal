#!/bin/bash
# test/poller.test.sh — scripts/poller.sh starts a cycle when, and only when,
# the agent's due set calls for one.
#
# Each scenario runs the real poller for a fixed number of ticks against a temp
# agent. The poll command replays one fixture per tick, and the wake command is
# a stub that records each launch, so the result is deterministic.
#
# Run directly or via `npm test` (the test/*.test.sh loop).

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }

echo "# poller.sh"

if ! command -v flock >/dev/null 2>&1; then
  echo "  SKIP - flock not available (non-Linux host); the poller is Linux-only"
  exit 0
fi

TMP=$(mktemp -d)
HOLDER=""
cleanup() { [ -n "$HOLDER" ] && kill -9 "$HOLDER" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

# new_agent NAME RETRY CRON_LINE — a temp agent whose poll command prints
# ticks/<n> on its n-th call (0-based) and exits with ticks/<n>.rc if present.
new_agent() {
  local a="$TMP/$1"
  mkdir -p "$a/ticks" "$a/logs"
  cat > "$a/agent.yaml" <<YAML
name: poller-test-$1
lock-file: $a/cycle.lock
cron-file: $a/cron
poll:
  command: bash $a/replay.sh
  interval-seconds: 0
  retry-seconds: $2
YAML
  printf '%s\n' "$3" > "$a/cron"
  cat > "$a/replay.sh" <<'SH'
d="$(dirname "$0")"
n=$(cat "$d/n" 2>/dev/null || echo 0)
echo $((n + 1)) > "$d/n"
[ -f "$d/ticks/$n" ] && cat "$d/ticks/$n"
[ -f "$d/ticks/$n.rc" ] && { echo "replay failed" >&2; exit "$(cat "$d/ticks/$n.rc")"; }
exit 0
SH
  echo "$a"
}

# run_poller AGENT TICKS — returns once the poller has done TICKS ticks.
run_poller() {
  POLLER_WAKE_CMD="bash -c 'echo launch >> $1/launches'" POLLER_MAX_TICKS="$2" \
    bash "$SCRIPT_DIR/scripts/poller.sh" "$1" >/dev/null 2>&1
  sleep 0.3  # the stub wake runs detached; let it write
}

launches() { [ -f "$1/launches" ] && wc -l < "$1/launches" | tr -d ' ' || echo 0; }
status() { python3 -c "import json,sys; print(json.load(open('$1/logs/poller-status.json'))$2)"; }
events_of() { grep -c "\"type\": *\"$2\"" "$1/logs/events.jsonl" 2>/dev/null || echo 0; }

ON='0 */6 * * * root bash /x/scripts/wake.sh /a'
OFF='# 0 */6 * * * root bash /x/scripts/wake.sh /a'

# ── nothing due: no cycle ──
A=$(new_agent empty 1800 "$ON")
run_poller "$A" 3
check "an empty due set starts nothing" "$(launches "$A")" "0"
check "status records nothing due" "$(status "$A" "['dueCount']")" "0"
check "status records the tick as ok" "$(status "$A" "['ok']")" "True"

# ── a due set starts one cycle; the same set again does not ──
A=$(new_agent same 1800 "$ON")
printf 'item:1\n' > "$A/ticks/0"; printf 'item:1\n' > "$A/ticks/1"; printf 'item:1\n' > "$A/ticks/2"
run_poller "$A" 3
check "a due set starts one cycle, not one per tick" "$(launches "$A")" "1"

# ── order and whitespace do not make a new set ──
A=$(new_agent order 1800 "$ON")
printf 'b\na\n' > "$A/ticks/0"; printf '  a\n\nb  \n' > "$A/ticks/1"
run_poller "$A" 2
check "reordered keys are the same set" "$(launches "$A")" "1"

# ── a changed set starts another cycle ──
A=$(new_agent changed 1800 "$ON")
printf 'item:1\n' > "$A/ticks/0"; printf 'item:1\npr:7@abc\n' > "$A/ticks/1"; printf 'pr:7@def\n' > "$A/ticks/2"
run_poller "$A" 3
check "each change to the due set starts a cycle" "$(launches "$A")" "3"
check "status lists what the last launch saw" "$(status "$A" "['lastLaunchDue']")" "['pr:7@def']"

# ── the same set is retried after retry-seconds ──
A=$(new_agent retry 0 "$ON")
printf 'item:1\n' > "$A/ticks/0"; printf 'item:1\n' > "$A/ticks/1"
run_poller "$A" 2
check "an unchanged set is retried once retry-seconds pass" "$(launches "$A")" "2"

# ── a held lock starts nothing ──
A=$(new_agent locked 1800 "$ON")
printf 'item:1\n' > "$A/ticks/0"; printf 'item:2\n' > "$A/ticks/1"
bash -c 'exec 201>"$1"; flock -n 201 || exit 1; sleep 60' _ "$A/cycle.lock" >/dev/null 2>&1 &
HOLDER=$!
sleep 0.3
run_poller "$A" 2
check "nothing starts while a cycle holds the lock" "$(launches "$A")" "0"
check "status says a cycle is running" "$(status "$A" "['cycleRunning']")" "True"
kill -9 "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null; HOLDER=""

# ── the portal's .starting marker counts as running ──
A=$(new_agent starting 1800 "$ON")
printf 'item:1\n' > "$A/ticks/0"
touch "$A/cycle.lock.starting"
run_poller "$A" 1
check "a fresh .starting marker holds off a launch" "$(launches "$A")" "0"

# ── the cron switch turns polling off ──
A=$(new_agent off 1800 "$OFF")
printf 'item:1\n' > "$A/ticks/0"
run_poller "$A" 2
check "a commented-out wake line starts nothing" "$(launches "$A")" "0"
check "the poll command is not even run" "$(cat "$A/n" 2>/dev/null || echo 0)" "0"
check "status records polling as off" "$(status "$A" "['enabled']")" "False"

# ── a failing command starts nothing and is logged once, then its recovery ──
A=$(new_agent failing 1800 "$ON")
printf '1' > "$A/ticks/0.rc"; printf '1' > "$A/ticks/1.rc"; printf '1' > "$A/ticks/2.rc"
run_poller "$A" 3
check "a failing poll command starts nothing" "$(launches "$A")" "0"
check "status records the failure" "$(status "$A" "['ok']")" "False"
check "status carries the command's stderr" "$(status "$A" "['error']")" "poll command failed (rc=1): replay failed"
check "the error is logged once, not every tick" "$(events_of "$A" error)" "1"

A=$(new_agent recovers 1800 "$ON")
printf '1' > "$A/ticks/0.rc"; printf 'item:1\n' > "$A/ticks/1"
run_poller "$A" 2
check "a recovered command can start a cycle" "$(launches "$A")" "1"
check "recovery is logged" "$(grep -c 'Poller recovered' "$A/logs/events.jsonl")" "1"

# ── no poll.command: the poller exits at once ──
A="$TMP/none"; mkdir -p "$A"; printf 'name: none\n' > "$A/agent.yaml"
timeout 10 bash "$SCRIPT_DIR/scripts/poller.sh" "$A" >/dev/null 2>&1
check "without poll.command the poller exits cleanly" "$?" "0"

echo "# poller.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
