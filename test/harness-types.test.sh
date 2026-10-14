#!/bin/bash
# harness-types.test.sh — read-harness-config.sh exports HARNESS_TYPES from harness.types or harness.type,
# and applies .harness-override.
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

echo "# .harness-override"
FW_CODEX="bash $FRAMEWORK_DIR/scripts/codex-harness.sh"
echo '{"harness":{"type":"claude-code","types":["claude-code","codex"]}}' > "$TMP/portal.config.json"
rm -f "$TMP/.harness-override"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_TYPE" = "claude-code" ] && ok "no override runs the default type" || fail "HARNESS_TYPE=$HARNESS_TYPE"
[ "$HARNESS_CMD" = "claude --print" ] && ok "default claude command" || fail "HARNESS_CMD=$HARNESS_CMD"
case "$HARNESS_EXTRA_FLAGS" in "--effort max"*) ok "claude default flags applied";; *) fail "HARNESS_EXTRA_FLAGS=$HARNESS_EXTRA_FLAGS";; esac

echo "codex" > "$TMP/.harness-override"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_TYPE" = "codex" ] && ok "override selects codex" || fail "HARNESS_TYPE=$HARNESS_TYPE"
[ "$HARNESS_DEFAULT_TYPE" = "claude-code" ] && ok "default type still reported" || fail "HARNESS_DEFAULT_TYPE=$HARNESS_DEFAULT_TYPE"
[ "$HARNESS_CMD" = "$FW_CODEX" ] && ok "codex runs the framework harness script" || fail "HARNESS_CMD=$HARNESS_CMD"
[ -z "$HARNESS_EXTRA_FLAGS" ] && ok "no claude flags passed to codex" || fail "HARNESS_EXTRA_FLAGS=$HARNESS_EXTRA_FLAGS"

echo '{"harness":{"type":"claude-code","types":["claude-code","codex"],"extraFlags":"--effort high"}}' > "$TMP/portal.config.json"
eval "$(bash "$SCRIPT" "$TMP")"
[ -z "$HARNESS_EXTRA_FLAGS" ] && ok "default type's extraFlags dropped under override" || fail "HARNESS_EXTRA_FLAGS=$HARNESS_EXTRA_FLAGS"
rm -f "$TMP/.harness-override"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_EXTRA_FLAGS" = "--effort high" ] && ok "extraFlags kept for the default type" || fail "HARNESS_EXTRA_FLAGS=$HARNESS_EXTRA_FLAGS"

echo '{"harness":{"type":"claude-code","types":["claude-code","codex"]}}' > "$TMP/portal.config.json"
echo "goose" > "$TMP/.harness-override"
WARN="$(bash "$SCRIPT" "$TMP" 2>&1 >/dev/null)"
eval "$(bash "$SCRIPT" "$TMP" 2>/dev/null)"
[ "$HARNESS_TYPE" = "claude-code" ] && ok "unlisted override ignored" || fail "HARNESS_TYPE=$HARNESS_TYPE"
case "$WARN" in *"ignoring .harness-override 'goose'"*) ok "unlisted override warns";; *) fail "warning was: $WARN";; esac

echo "codex" > "$TMP/.harness-override"
echo '{"harness":{"type":"claude-code","types":["claude-code","codex"],"command":"bash scripts/w.sh"}}' > "$TMP/portal.config.json"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_TYPE" = "claude-code" ] && [ "$HARNESS_CMD" = "bash scripts/w.sh" ] \
  && ok "override ignored when the agent has its own wrapper command" || fail "HARNESS_TYPE=$HARNESS_TYPE HARNESS_CMD=$HARNESS_CMD"

echo '{"harness":{"type":"codex"}}' > "$TMP/portal.config.json"
rm -f "$TMP/.harness-override"
eval "$(bash "$SCRIPT" "$TMP")"
[ "$HARNESS_CMD" = "$FW_CODEX" ] && ok "codex as the default type also uses the framework script" || fail "HARNESS_CMD=$HARNESS_CMD"

rm -rf "$TMP"

echo ""
echo "# Results: $((OK+FAIL)) tests, $OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
