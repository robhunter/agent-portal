#!/bin/bash
set -euo pipefail
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TASK_TMP=$(mktemp -d)
trap 'rm -rf "$TASK_TMP"' EXIT
. "$FRAMEWORK_DIR/test/helpers/offline-framework.sh"
make_offline_framework "$FRAMEWORK_DIR" "$TASK_TMP/framework"
export GIT_CONFIG_GLOBAL="$TASK_TMP/global.gitconfig" GIT_CONFIG_SYSTEM="$TASK_TMP/system.gitconfig"
printf '[fixture]\n  marker = global\n' > "$GIT_CONFIG_GLOBAL"
printf '[fixture]\n  marker = system\n' > "$GIT_CONFIG_SYSTEM"
unset OPEN_ROUTER_KEY TELEGRAM_TOKEN TELEGRAM_CHAT_ID
node - "$TASK_TMP/framework/scripts/wake.sh" "$TASK_TMP/framework/host-nvm" <<'JS'
const fs = require('fs');
const file = process.argv[2];
const old = '$HOME/.nvm';
const source = fs.readFileSync(file, 'utf8');
if (source.split(old).length !== 2) throw new Error('Missing fixture NVM boundary');
fs.writeFileSync(file, source.replace(old, process.argv[3]));
JS
printf 'echo "FRAMEWORK_COMMIT=fixture"\n' > "$TASK_TMP/framework/scripts/framework-update.sh"
printf 'exit 0\n' > "$TASK_TMP/framework/scripts/consolidate-memory.sh"
cat > "$TASK_TMP/framework/scripts/run-hooks.sh" <<'SH'
if [ "$3" = post-cycle ] && [ "${FIXTURE_POST_FAIL:-0}" = 1 ]; then exit 9; fi
exit 0
SH
mkdir -p "$TASK_TMP/bin"
cat > "$TASK_TMP/bin/curl" <<'SH'
#!/bin/bash
printf '%s\n' "$@" >> "$FIXTURE_CALLS"
exit "${FIXTURE_NOTIFY_EXIT:-0}"
SH
chmod +x "$TASK_TMP/bin/curl"
export PATH="$TASK_TMP/bin:$PATH" CYCLE_ATTEMPT_RETRY_DELAY=0
passed=0
check() { "$@" || { echo "FAIL: $*"; exit 1; }; passed=$((passed+1)); }

for layout in legacy nested no-token; do
  agent="$TASK_TMP/$layout"
  data=.
  [ "$layout" != nested ] || data=state/nested
  mkdir -p "$agent/$data/logs"
  name="cycle-alert-$layout-$$"
  cat > "$agent/agent.yaml" <<YAML
name: $name
repo: ""
lock-file: $agent/cycle.lock
wake-prompt: fixture
YAML
  cat > "$agent/harness.sh" <<'SH'
#!/bin/bash
cat > /dev/null
if [ "$FIXTURE_MODE" = fail ]; then
  n=$(cat "$FIXTURE_ATTEMPTS" 2>/dev/null || echo 0)
  echo $((n+1)) > "$FIXTURE_ATTEMPTS"
  if [ $((n%2)) -eq 0 ]; then echo 'First attempt diagnostic';
  else echo 'Failed to authenticate: OAuth session expired and could not be refreshed'; fi
  exit 1
fi
printf '{"type":"work","summary":"fixture work"}\n' >> "$DATA_DIR/logs/events.jsonl"
SH
  node - "$agent" "$data" <<'JS'
const fs = require('fs');
const [agent, dataDir] = process.argv.slice(2);
fs.writeFileSync(agent + '/portal.config.json', JSON.stringify({ dataDir, harness: { type: 'goose', command: 'bash ' + agent + '/harness.sh' } }));
JS
  git -C "$agent" init -q -b main
  git -C "$agent" config user.name Fixture
  git -C "$agent" config user.email fixture@example.invalid
  git -C "$agent" add -A
  git -C "$agent" commit -qm initial
  export FIXTURE_CALLS="$agent/calls" FIXTURE_ATTEMPTS="$agent/attempts" FIXTURE_MODE=success
  export TELEGRAM_TOKEN=fixture-token TELEGRAM_CHAT_ID=fixture-chat
  [ "$layout" != no-token ] || unset TELEGRAM_TOKEN
  for n in 1 2 3; do
    bash "$TASK_TMP/framework/scripts/wake.sh" "$agent" > "$agent/wake.out" 2>&1
  done
  state="$agent/$data/logs/cycle-failure-alert.json"
  check test ! -e "$state"
  check test ! -e "$FIXTURE_CALLS"
  FIXTURE_MODE=fail
  for n in 1 2 3; do
    bash "$TASK_TMP/framework/scripts/wake.sh" "$agent" > "$agent/wake.out" 2>&1
    if [ "$n" -lt 3 ]; then check test ! -e "$FIXTURE_CALLS"; fi
  done
  if [ "$layout" = no-token ]; then
    check test ! -e "$state"
    check test ! -e "$FIXTURE_CALLS"
  else
    check test -s "$state"
    check grep -Fq "$name: 3 consecutive scheduled cycles failed." "$FIXTURE_CALLS"
    check grep -Fq 'Failed to authenticate: OAuth session expired and could not be refreshed' "$FIXTURE_CALLS"
    check test "$(grep -c '^text=' "$FIXTURE_CALLS")" = 1
    alert_calls=1
    if [ "$layout" = legacy ]; then
      node - "$state" <<'JS'
const fs = require('fs');
const file = process.argv[2];
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
state.notifiedAt = '2020-01-01T00:00:00Z';
fs.writeFileSync(file, JSON.stringify(state));
JS
      cp "$state" "$agent/state-before"
      export FIXTURE_NOTIFY_EXIT=7
      status=0
      bash "$TASK_TMP/framework/scripts/wake.sh" "$agent" > "$agent/wake.out" 2>&1 || status=$?
      check test "$status" = 0
      check cmp -s "$state" "$agent/state-before"
      check grep -Fq 'cycle failure alert skipped or failed (non-fatal)' "$agent/$data/logs/cycles/wake-steps.log"
      check test "$(grep -c '^text=' "$FIXTURE_CALLS")" = 2
      export FIXTURE_NOTIFY_EXIT=0
      alert_calls=3
    fi
    bash "$TASK_TMP/framework/scripts/wake.sh" "$agent" > "$agent/wake.out" 2>&1
    check test "$(grep -c '^text=' "$FIXTURE_CALLS")" = "$alert_calls"
    FIXTURE_MODE=success
    if [ "$layout" = legacy ]; then
      export FIXTURE_POST_FAIL=1
      status=0
      bash "$TASK_TMP/framework/scripts/wake.sh" "$agent" > "$agent/wake.out" 2>&1 || status=$?
      check test "$status" = 9
      check test -s "$state"
      check test "$(grep -c '^text=' "$FIXTURE_CALLS")" = "$alert_calls"
      unset FIXTURE_POST_FAIL
    fi
    bash "$TASK_TMP/framework/scripts/wake.sh" "$agent" > "$agent/wake.out" 2>&1
    check grep -Fq "$name is running again" "$FIXTURE_CALLS"
    check test "$(grep -c '^text=' "$FIXTURE_CALLS")" = "$((alert_calls+1))"
    check test ! -e "$state"
    bash "$TASK_TMP/framework/scripts/wake.sh" "$agent" > "$agent/wake.out" 2>&1
    check test "$(grep -c '^text=' "$FIXTURE_CALLS")" = "$((alert_calls+1))"
  fi
  if [ "$data" != . ]; then
    check test ! -e "$agent/logs/cycle-failure-alert.json"
  fi
  rm -f "/tmp/agent-$name-wake-prompt.txt" "/tmp/agent-$name-cycle-failed" "/tmp/agent-$name-branch-skip-count"
done
printf '%s passed, 0 failed\n' "$passed"
