#!/bin/bash
# harness-types.test.sh — read-harness-config.sh exports HARNESS_TYPES from harness.types or harness.type.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$FRAMEWORK_DIR/scripts/read-harness-config.sh"

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d -t harness-types-XXXXXX)

echo "# harness.types listed"
echo '{"harness":{"type":"codex","types":["codex","claude-code"],"command":"bash scripts/w.sh"}}' > "$TMP/portal.config.json"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_TYPE" = "codex" ] && ok "HARNESS_TYPE=codex" || fail "HARNESS_TYPE=$HARNESS_TYPE"
[ "$HARNESS_TYPES" = "codex claude-code" ] && ok "HARNESS_TYPES lists both" || fail "HARNESS_TYPES=$HARNESS_TYPES"

echo "# harness.type only"
echo '{"harness":{"type":"codex","command":"bash scripts/w.sh"}}' > "$TMP/portal.config.json"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_TYPES" = "codex" ] && ok "HARNESS_TYPES falls back to type" || fail "HARNESS_TYPES=$HARNESS_TYPES"

echo "# no harness block"
echo '{"name":"T"}' > "$TMP/portal.config.json"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_TYPES" = "claude-code" ] && ok "HARNESS_TYPES defaults to claude-code" || fail "HARNESS_TYPES=$HARNESS_TYPES"

echo "# vm-setup codex gate"
codex_wanted() { (cd "$TMP" && node -e '
  const h = JSON.parse(require("fs").readFileSync("portal.config.json", "utf-8")).harness || {};
  process.exit([].concat(h.types || h.type || []).includes("codex") ? 0 : 1);
'); }
echo '{"harness":{"type":"script","types":["codex","claude-code"]}}' > "$TMP/portal.config.json"
codex_wanted && ok "codex in types installs codex" || fail "codex in types not detected"
echo '{"harness":{"type":"claude-code"}}' > "$TMP/portal.config.json"
codex_wanted && fail "claude-code only should not install codex" || ok "claude-code only skips codex"

rm -rf "$TMP"

echo ""
echo "# Results: $((OK+FAIL)) tests, $OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
