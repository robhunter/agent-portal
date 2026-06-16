#!/bin/bash
# data-dir-scripts.test.sh — Verify shell scripts honor portal.config.json dataDir.
# Both legacy (dataDir: ".") and new (dataDir: "data") layouts.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$FRAMEWORK_DIR/scripts"

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

make_agent() {
  local mode="$1"  # "legacy" or "data"
  local tmpdir=$(mktemp -d -t data-dir-scripts-XXXXXX)
  if [ "$mode" = "data" ]; then
    cat > "$tmpdir/portal.config.json" <<EOF
{"name":"T","port":0,"agentDir":"$tmpdir","dataDir":"data","cronFile":"/nonexistent","lockFile":"$tmpdir/lock"}
EOF
  else
    cat > "$tmpdir/portal.config.json" <<EOF
{"name":"T","port":0,"agentDir":"$tmpdir","cronFile":"/nonexistent","lockFile":"$tmpdir/lock"}
EOF
  fi
  # Also create an agent.yaml stub since some scripts (cron-setup.sh, start.sh) read it
  cat > "$tmpdir/agent.yaml" <<EOF
name: T
port: 8099
repo: example/test
lock-file: $tmpdir/lock
cron-file: $tmpdir/cron
cron-schedule: 0 0 * * *
wake-prompt: stub
EOF
  echo "$tmpdir"
}

echo "# log-event.sh respects DATA_DIR"
echo "## Test 1: default (legacy) — writes to <agentDir>/logs/events.jsonl"
TMP=$(make_agent legacy)
unset DATA_DIR
bash "$SCRIPTS/log-event.sh" "$TMP" cycle_start "smoke test"
[ -f "$TMP/logs/events.jsonl" ] && ok "wrote to legacy logs/events.jsonl" || fail "missing legacy logs/events.jsonl"
[ ! -e "$TMP/data/logs" ] && ok "no data/ dir created in legacy mode" || fail "unexpected data/ dir"
grep -q "smoke test" "$TMP/logs/events.jsonl" && ok "event content recorded" || fail "event content missing"
rm -rf "$TMP"

echo "## Test 2: dataDir=data — writes to <agentDir>/data/logs/events.jsonl"
TMP=$(make_agent data)
unset DATA_DIR
bash "$SCRIPTS/log-event.sh" "$TMP" cycle_start "smoke test"
[ -f "$TMP/data/logs/events.jsonl" ] && ok "wrote to data/logs/events.jsonl" || fail "missing data/logs/events.jsonl"
[ ! -e "$TMP/logs/events.jsonl" ] && ok "no root logs/events.jsonl in dataDir mode" || fail "unexpected root logs/"
grep -q "smoke test" "$TMP/data/logs/events.jsonl" && ok "event content recorded under data/" || fail "event content missing"
rm -rf "$TMP"

echo "## Test 3: DATA_DIR env override beats portal.config.json"
TMP=$(make_agent legacy)
DATA_DIR=data bash "$SCRIPTS/log-event.sh" "$TMP" cycle_start "env override"
[ -f "$TMP/data/logs/events.jsonl" ] && ok "env override redirected to data/" || fail "env override ignored"
rm -rf "$TMP"

echo "## Test 3b: special characters in the summary produce valid JSONL (not corruption)"
TMP=$(make_agent legacy)
unset DATA_DIR
TRICKY='Shipped "dark mode"; fixed C:\path, and a, comma'
bash "$SCRIPTS/log-event.sh" "$TMP" work "$TRICKY" agentdeals
LINE=$(tail -1 "$TMP/logs/events.jsonl")
if printf '%s' "$LINE" | python3 -c "import json,sys; json.loads(sys.stdin.read())" 2>/dev/null; then
  ok "summary with quotes/backslash/comma is valid JSON"
else
  fail "special-char summary corrupted the JSONL: $LINE"
fi
GOT=$(printf '%s' "$LINE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['summary'])" 2>/dev/null)
[ "$GOT" = "$TRICKY" ] && ok "summary round-trips exactly" || fail "summary mangled: got [$GOT] want [$TRICKY]"
PROJ=$(printf '%s' "$LINE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['project'])" 2>/dev/null)
[ "$PROJ" = "agentdeals" ] && ok "project field preserved" || fail "project field lost"
rm -rf "$TMP"

echo ""
echo "# log-journal.sh respects DATA_DIR"
echo "## Test 4: dataDir=data — writes to <agentDir>/data/journals/"
TMP=$(make_agent data)
unset DATA_DIR
bash "$SCRIPTS/log-journal.sh" "$TMP" auto rob note "test entry under data"
MONTH=$(date +%Y-%m)
[ -f "$TMP/data/journals/$MONTH.md" ] && ok "journal at data/journals/$MONTH.md" || fail "missing data/journals/$MONTH.md"
[ ! -d "$TMP/journals" ] && ok "no root journals/ in dataDir mode" || fail "unexpected root journals/"
rm -rf "$TMP"

echo "## Test 5: legacy — writes to <agentDir>/journals/"
TMP=$(make_agent legacy)
unset DATA_DIR
bash "$SCRIPTS/log-journal.sh" "$TMP" auto rob note "legacy journal"
[ -f "$TMP/journals/$MONTH.md" ] && ok "journal at legacy journals/$MONTH.md" || fail "missing legacy journals/$MONTH.md"
rm -rf "$TMP"

echo ""
echo "# read-harness-config.sh emits DATA_DIR"
TMP=$(make_agent data)
OUT=$(bash "$SCRIPTS/read-harness-config.sh" "$TMP")
echo "$OUT" | grep -q "export DATA_DIR='data'" && ok "emits DATA_DIR='data'" || fail "missing DATA_DIR export"
rm -rf "$TMP"

TMP=$(make_agent legacy)
OUT=$(bash "$SCRIPTS/read-harness-config.sh" "$TMP")
echo "$OUT" | grep -qE "export DATA_DIR='?\.'?" && ok "emits DATA_DIR='.' for default" || fail "missing default DATA_DIR"
rm -rf "$TMP"

echo ""
echo "# clear-done-todos.sh respects DATA_DIR"
echo "## Test 6: dataDir=data — reads/writes data/human_todos.md"
TMP=$(make_agent data)
mkdir -p "$TMP/data"
cat > "$TMP/data/human_todos.md" <<EOF
## Todos

- [x] Done item
- [ ] Pending item
EOF
unset DATA_DIR
bash "$SCRIPTS/clear-done-todos.sh" "$TMP" > /dev/null
grep -q "Done item" "$TMP/data/human_todos.md" && fail "done item should be removed" || ok "removed done item under data/"
grep -q "Pending item" "$TMP/data/human_todos.md" && ok "kept pending item" || fail "pending item lost"
rm -rf "$TMP"

echo ""
echo "# cron-setup.sh writes cron-wake.log under DATA_DIR"
TMP=$(make_agent data)
unset DATA_DIR
OUT=$(bash "$SCRIPTS/cron-setup.sh" "$TMP" 2>&1 || true)
echo "$OUT" | grep -q "data/logs/cycles/cron-wake.log" && ok "cron line includes data/logs/cycles/cron-wake.log" || fail "cron-wake.log path missing DATA_DIR prefix"
rm -rf "$TMP"

echo ""
echo "# Results: $((OK+FAIL)) tests, $OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
