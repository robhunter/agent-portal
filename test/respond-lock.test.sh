#!/bin/bash
# test/respond-lock.test.sh — respond.sh must release its lock on exit even when
# a child process inherits the lock fd (200).
#
# Regression test for the lock-fd-leak fixed by mirroring wake.sh's PR #66
# lock-reliability handling into respond.sh (release trap + 200>&- on children).
# Before the fix, a detached child spawned by the harness inherited the locked
# fd 200 and kept the lock's open file description locked after respond.sh
# exited, blocking every subsequent cycle until wake.sh's stale-lock timeout
# (~90 min). flock locks live on the open file description, so an inherited,
# never-released fd holds the lock for the lifetime of the child.
#
# Run directly or via `npm test` (the test/*.test.sh loop). CI-covered.

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESPOND="$SCRIPT_DIR/scripts/respond.sh"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }

echo "# respond.sh lock-release tests"

# respond.sh's lock handling is flock-based (Linux). Skip cleanly elsewhere.
if ! command -v flock >/dev/null 2>&1; then
  echo "  SKIP - flock not available (non-Linux host); respond.sh lock handling is Linux-only"
  exit 0
fi

TMP=$(mktemp -d)
LINGER_PID_FILE="$TMP/linger.pid"
cleanup() {
  [ -f "$LINGER_PID_FILE" ] && kill "$(cat "$LINGER_PID_FILE" 2>/dev/null)" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

LOCK_FILE="$TMP/agent.lock"

# Minimal agent: no workspaces (skips the git-pull block), a respond-prompt, a
# lock file. read-config.js maps name->AGENT_NAME, lock-file->AGENT_LOCK_FILE,
# respond-prompt->RESPOND_PROMPT_FILE.
cat > "$TMP/agent.yaml" <<YAML
name: respondlocktest
repo: example/none
lock-file: $LOCK_FILE
respond-prompt: |
  test respond prompt
YAML

# Point the harness at our mock. type != claude-code so read-harness-config.sh
# injects no default flags; dataDir "." keeps state under the temp agent dir.
cat > "$TMP/portal.config.json" <<JSON
{ "harness": { "type": "mock", "command": "bash $TMP/mock-harness.sh", "extraFlags": "" }, "dataDir": "." }
JSON

# Mock harness: drain the piped prompt, then spawn a lingering DETACHED child.
# The child inherits the harness's open fds (including fd 200 if respond.sh
# leaks it) but its stdout/stderr go to /dev/null so it does NOT hold the
# pipeline open (otherwise tee/respond.sh would block until it exits).
cat > "$TMP/mock-harness.sh" <<MOCK
#!/bin/bash
cat >/dev/null
nohup sleep 30 >/dev/null 2>&1 &
echo "\$!" > "$LINGER_PID_FILE"
exit 0
MOCK
chmod +x "$TMP/mock-harness.sh"

# Temp git repo so commit.sh (respond.sh's final step) succeeds locally.
git -C "$TMP" init -q
git -C "$TMP" config user.email test@example.com
git -C "$TMP" config user.name test
git -C "$TMP" add -A
git -C "$TMP" commit -qm init
mkdir -p "$TMP/logs"

# Run a full respond cycle. GH_TOKEN unset => commit.sh skips push (offline).
( cd "$TMP" && env -u GH_TOKEN bash "$RESPOND" "$TMP" ) >"$TMP/respond.out" 2>&1
RESPOND_RC=$?

# Sanity: the lingering child must still be alive when we check the lock — else
# a "lock free" result would be meaningless (the leak window already closed).
LINGER_PID=$(cat "$LINGER_PID_FILE" 2>/dev/null || echo "")
if [ -n "$LINGER_PID" ] && kill -0 "$LINGER_PID" 2>/dev/null; then
  ok "lingering child alive at lock-check time (valid test window)"
else
  bad "lingering child not alive at check time — invalid window (respond rc=$RESPOND_RC); see $TMP/respond.out"
fi

# THE KEY ASSERTION: with the lingering child still running, the lock must be
# acquirable from a fresh open file description — respond.sh released it on exit.
# Without the fix the child holds the locked fd 200 and this flock -n is denied.
exec 9>"$LOCK_FILE"
if flock -n 9; then
  ok "lock is free after respond.sh exit (no fd-200 leak into child)"
  flock -u 9
else
  bad "lock still HELD after respond.sh exit (fd-200 leaked into lingering child)"
fi
exec 9>&-

echo ""
echo "respond.sh lock-release: $PASS passed, $FAIL failed"
RC=0
[ "$FAIL" -ne 0 ] && RC=1
exit "$RC"
