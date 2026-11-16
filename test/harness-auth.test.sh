#!/bin/bash
# harness-auth.test.sh — scripts/harness-auth.py: selftest, and scan's output contract with wake.sh.
set -e
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d -t harness-auth-XXXXXX)
OK=0; FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

python3 "$FRAMEWORK_DIR/scripts/harness-auth.py" selftest >/dev/null && ok "selftest" || fail "selftest"

echo "ERROR: unexpected status 401 Unauthorized: auth error code: token_revoked" > "$TMP/c.log"
out=$(python3 "$FRAMEWORK_DIR/scripts/harness-auth.py" scan "$TMP/data" "$TMP/c.log")
case "$out" in "codex: "*token_revoked*) ok "scan prints '<harness>: <line>' for a new failure";; *) fail "scan printed: $out";; esac
out=$(python3 "$FRAMEWORK_DIR/scripts/harness-auth.py" scan "$TMP/data" "$TMP/c.log")
[ -z "$out" ] && ok "a failure already on record is not reported again" || fail "repeat printed: $out"
echo "    assert 'token_revoked' in reply" > "$TMP/quoted.log"
out=$(python3 "$FRAMEWORK_DIR/scripts/harness-auth.py" scan --strict "$TMP/data3" "$TMP/quoted.log")
[ -z "$out" ] && ok "--strict ignores a quoted signature" || fail "--strict printed: $out"
echo "2026-11-16T17:42:33Z ERROR codex_models_manager::manager: 401 Unauthorized: Encountered invalidated oauth token" > "$TMP/codexlog.log"
out=$(python3 "$FRAMEWORK_DIR/scripts/harness-auth.py" scan --strict "$TMP/data4" "$TMP/codexlog.log")
case "$out" in "codex: "*) ok "--strict catches Codex's own error line";; *) fail "--strict missed: $out";; esac
python3 "$FRAMEWORK_DIR/scripts/harness-auth.py" scan "$TMP/data2" "$TMP/missing.log" >/dev/null && ok "missing logs are not an error" || fail "missing logs"

rm -rf "$TMP"
echo "# harness-auth: $OK ok, $FAIL failed"
[ "$FAIL" -eq 0 ]
