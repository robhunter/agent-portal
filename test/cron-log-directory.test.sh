#!/bin/bash
set -euo pipefail

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/framework/scripts"
cp "$FRAMEWORK_DIR/scripts/cron-setup.sh" "$FRAMEWORK_DIR/scripts/read-config.js" \
  "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$TMP/framework/scripts/"
ln -s "$FRAMEWORK_DIR/node_modules" "$TMP/framework/node_modules"
cat > "$TMP/framework/scripts/wake.sh" <<'EOF'
#!/bin/bash
printf 'wake stub invoked\n'
printf '%s\n' "$1" > "$1/invoked"
EOF

passed=0
failed=0
check() {
  if "$@"; then
    passed=$((passed + 1))
    echo "  ok - $*"
  else
    failed=$((failed + 1))
    echo "  not ok - $*"
  fi
}

make_agent() {
  AGENT="$TMP/$1"
  mkdir -p "$AGENT"
  cat > "$AGENT/agent.yaml" <<EOF
name: cron-fixture
cron-file: $AGENT/cronfile
cron-schedule: 0 */4 * * *
EOF
}

for layout in legacy default explicit-root nested config-beats-env default-beats-env env-fallback; do
  echo "# fresh cron install: $layout"
  make_agent "$layout"
  inherited=ignored
  expected=.
  case "$layout" in
    legacy) inherited=. ;;
    default) inherited=.; printf '{}\n' > "$AGENT/portal.config.json" ;;
    default-beats-env) printf '{}\n' > "$AGENT/portal.config.json" ;;
    explicit-root) printf '{"dataDir":"."}\n' > "$AGENT/portal.config.json" ;;
    nested|config-beats-env)
      printf '{"dataDir":"state/nested"}\n' > "$AGENT/portal.config.json"
      expected=state/nested
      if [ "$layout" = nested ]; then inherited=.; fi
      ;;
    env-fallback) inherited=env-state; expected=env-state ;;
  esac

  DATA_DIR="$inherited" bash "$TMP/framework/scripts/cron-setup.sh" "$AGENT" > "$TMP/show"
  check test ! -d "$AGENT/$expected/logs"
  check test ! -e "$AGENT/cronfile"

  DATA_DIR="$inherited" bash "$TMP/framework/scripts/cron-setup.sh" "$AGENT" install > "$TMP/install"
  check test -d "$AGENT/$expected/logs/cycles"
  if [ "$expected" != . ]; then
    check test ! -d "$AGENT/logs"
  fi
  if [ "$inherited" != "$expected" ]; then
    check test ! -d "$AGENT/$inherited/logs"
  fi

  # Run the generated command after its environment bootstrap, without sourcing
  # host credentials or requiring nvm. The wake stub must be reached through the
  # real shell redirection, with no directory creation in the stub itself.
  entry=$(cat "$AGENT/cronfile")
  command_tail="${entry#* && cd }"
  check test "$command_tail" != "$entry"
  check bash --noprofile --norc -c "cd $command_tail"
  check test -f "$AGENT/invoked"
  check grep -Fxq "$AGENT" "$AGENT/invoked"
  check grep -Fxq 'wake stub invoked' "$AGENT/$expected/logs/cycles/cron-wake.log"

  printf 'existing log\n' >> "$AGENT/$expected/logs/cycles/cron-wake.log"
  cp "$AGENT/$expected/logs/cycles/cron-wake.log" "$TMP/before"
  cp "$AGENT/cronfile" "$TMP/cron-before"
  DATA_DIR="$inherited" bash "$TMP/framework/scripts/cron-setup.sh" "$AGENT" install > "$TMP/reinstall"
  check cmp -s "$TMP/before" "$AGENT/$expected/logs/cycles/cron-wake.log"
  check cmp -s "$TMP/cron-before" "$AGENT/cronfile"
done

echo '# a log-directory failure leaves an existing cron file untouched'
make_agent blocked
printf 'not a directory\n' > "$AGENT/logs"
printf 'previous schedule\n' > "$AGENT/cronfile"
cp "$AGENT/cronfile" "$TMP/blocked-before"
status=0
DATA_DIR=. bash "$TMP/framework/scripts/cron-setup.sh" "$AGENT" install > "$TMP/blocked.out" 2> "$TMP/blocked.err" || status=$?
check test "$status" -ne 0
check cmp -s "$TMP/blocked-before" "$AGENT/cronfile"
check test -s "$TMP/blocked.err"

echo "$passed passed, $failed failed"
test "$failed" -eq 0
