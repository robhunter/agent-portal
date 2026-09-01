#!/bin/bash
# test/cron-disabled-sentinel.test.sh — cron-setup.sh must honour a
# .cron-disabled sentinel in the agent directory.
#
# The case that motivated it: /etc/cron.d/<agent> lives in the container's
# writable layer, so toggling cron off there is erased whenever the container
# restarts and start.sh reinstalls the schedule. An agent switched off came
# back on by itself — including when something restarted it automatically.
# The sentinel lives in the agent directory, which is bind-mounted, so the
# off state survives.

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
    command: "bash scripts/extra.sh"
    log: "logs/extra.log"
EOF

install_cron() {
  bash "$FRAMEWORK_DIR/scripts/cron-setup.sh" "$AGENT_DIR" install >/dev/null 2>&1
}

wake_commented() {
  grep 'wake.sh' "$AGENT_DIR/cronfile" | head -1 | grep -q '^[[:space:]]*#' && echo yes || echo no
}

extra_commented() {
  grep 'extra.sh' "$AGENT_DIR/cronfile" | head -1 | grep -q '^[[:space:]]*#' && echo yes || echo no
}

echo "# cron-setup.sh .cron-disabled sentinel"

install_cron
check "no sentinel installs an active wake entry" "$(wake_commented)" "no"

touch "$AGENT_DIR/.cron-disabled"
install_cron
check "sentinel installs the wake entry commented out" "$(wake_commented)" "yes"

check "extra cron entries are left active" "$(extra_commented)" "no"

install_cron
check "reinstalling with the sentinel stays disabled" "$(wake_commented)" "yes"

occurrences=$(grep -c 'wake.sh' "$AGENT_DIR/cronfile")
check "the wake entry is not duplicated on reinstall" "$occurrences" "1"

double_hash=$(grep 'wake.sh' "$AGENT_DIR/cronfile" | head -1 | grep -qE '^##' && echo yes || echo no)
check "repeated installs do not stack comment markers" "$double_hash" "no"

rm "$AGENT_DIR/.cron-disabled"
install_cron
check "removing the sentinel re-enables the wake entry" "$(wake_commented)" "no"

echo ""
echo "# Results: $((pass+fail)) tests, $pass passed, $fail failed"
[ "$fail" -eq 0 ]
