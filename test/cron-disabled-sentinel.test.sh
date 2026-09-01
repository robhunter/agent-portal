#!/bin/bash
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { echo "  ok - $1"; pass=$((pass+1)); }
notok() { echo "  not ok - $1"; fail=$((fail+1)); }
check() { [ "$2" = "$3" ] && ok "$1" || notok "$1 (got '$2', want '$3')"; }

AGENT_DIR="$TMP/agent"
mkdir -p "$AGENT_DIR/logs/cycles"
cat > "$AGENT_DIR/agent.yaml" <<EOF
name: fixture-agent
port: 9999
lock-file: /tmp/fixture-agent.lock
cron-file: $AGENT_DIR/cronfile
cron-schedule: 0 */4 * * *
timezone: UTC
extra-cron:
  - schedule: "30 5 * * *"
    command: "bash scripts/digest.sh"
    log: "logs/digest.log"
  - schedule: "0 * * * *"
    command: "bash scripts/heartbeat.sh"
    log: "logs/heartbeat.log"
    disable-with-wake: false
EOF

install_cron() {
  bash "$FRAMEWORK_DIR/scripts/cron-setup.sh" "$AGENT_DIR" install >/dev/null 2>&1
}

commented() {
  grep "$1" "$AGENT_DIR/cronfile" | head -1 | grep -q '^[[:space:]]*#' && echo yes || echo no
}

echo "# cron-setup.sh .cron-disabled sentinel"

install_cron
check "no sentinel leaves the wake entry active" "$(commented wake.sh)" "no"
check "no sentinel leaves extra entries active" "$(commented digest.sh)" "no"

touch "$AGENT_DIR/.cron-disabled"
install_cron
check "sentinel comments out the wake entry" "$(commented wake.sh)" "yes"
check "sentinel comments out extra entries by default" "$(commented digest.sh)" "yes"
check "disable-with-wake false keeps an entry active" "$(commented heartbeat.sh)" "no"

install_cron
check "reinstalling with the sentinel stays disabled" "$(commented wake.sh)" "yes"

occurrences=$(grep -c 'wake.sh' "$AGENT_DIR/cronfile")
check "the wake entry is not duplicated on reinstall" "$occurrences" "1"

double_hash=$(grep 'wake.sh' "$AGENT_DIR/cronfile" | head -1 | grep -qE '^##' && echo yes || echo no)
check "repeated installs do not stack comment markers" "$double_hash" "no"

rm "$AGENT_DIR/.cron-disabled"
install_cron
check "removing the sentinel re-enables the wake entry" "$(commented wake.sh)" "no"
check "removing the sentinel re-enables extra entries" "$(commented digest.sh)" "no"

echo ""
echo "# Results: $((pass+fail)) tests, $pass passed, $fail failed"
[ "$fail" -eq 0 ]
