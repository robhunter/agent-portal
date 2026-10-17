#!/bin/bash
# commit-remote.test.sh — commit.sh pushes where agent.yaml says, and a failed
# push is an `error` event rather than a silent warning or a failed cycle.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$FRAMEWORK_DIR/scripts"

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@localhost GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@localhost
unset GH_TOKEN TEST_PUSH_TOKEN DATA_DIR

# An agent repo with a change to commit. $1 = extra agent.yaml lines.
make_agent() {
  local tmp; tmp=$(mktemp -d -t commit-remote-XXXXXX)
  printf 'name: T\nrepo: example/test\n%s\n' "$1" > "$tmp/agent.yaml"
  (cd "$tmp" && git init -q -b main && echo x > f && git add -A && git commit -qm init && echo y > f)
  echo "$tmp"
}
events() { cat "$1/logs/events.jsonl" 2>/dev/null || true; }
error_events() { events "$1" | grep -c '"type":"error"' || true; }

echo "# read-config.js exposes the push settings"
TMP=$(make_agent 'git-remote: https://dev.azure.com/o/p/_git/r
git-token-env: TEST_PUSH_TOKEN')
OUT=$(node "$SCRIPTS/read-config.js" "$TMP/agent.yaml")
echo "$OUT" | grep -qx "AGENT_GIT_REMOTE='https://dev.azure.com/o/p/_git/r'" && ok "AGENT_GIT_REMOTE" || fail "AGENT_GIT_REMOTE missing: $OUT"
echo "$OUT" | grep -qx "AGENT_GIT_TOKEN_ENV='TEST_PUSH_TOKEN'" && ok "AGENT_GIT_TOKEN_ENV" || fail "AGENT_GIT_TOKEN_ENV missing"
rm -rf "$TMP"

echo "# default (repo only, no token): unchanged offline behaviour"
TMP=$(make_agent '')
OUT=$(bash "$SCRIPTS/commit.sh" "$TMP" "t" 2>&1); RC=$?
[ "$RC" -eq 0 ] && ok "exit 0" || fail "exit $RC"
echo "$OUT" | grep -q "GH_TOKEN not set, skipping push" && ok "skips push with the old warning" || fail "unexpected: $OUT"
[ "$(error_events "$TMP")" = 0 ] && ok "no error event" || fail "logged an error event offline"
[ "$(cd "$TMP" && git log --oneline | wc -l | tr -d ' ')" = 2 ] && ok "committed locally" || fail "no local commit"
rm -rf "$TMP"

echo "# git-remote to a local bare repo: pushes there"
BARE=$(mktemp -d -t commit-remote-bare-XXXXXX); git init -q --bare -b main "$BARE"
TMP=$(make_agent "git-remote: file://$BARE")
bash "$SCRIPTS/commit.sh" "$TMP" "t" >/dev/null 2>&1
[ "$(git -C "$BARE" rev-parse main 2>/dev/null)" = "$(git -C "$TMP" rev-parse main)" ] \
  && ok "bare repo received the commit" || fail "push did not land"
[ "$(error_events "$TMP")" = 0 ] && ok "no error event on success" || fail "error event on success"
rm -rf "$TMP" "$BARE"

echo "# unreachable remote: logged, not fatal"
TMP=$(make_agent "git-remote: file://$TMP/does-not-exist")
OUT=$(bash "$SCRIPTS/commit.sh" "$TMP" "t" 2>&1); RC=$?
[ "$RC" -eq 0 ] && ok "exit 0 (cycle not failed)" || fail "exit $RC"
[ "$(error_events "$TMP")" = 1 ] && ok "one error event" || fail "error events: $(events "$TMP")"
events "$TMP" | grep -q 'git push to file://' && ok "event names the remote" || fail "event lacks remote"
[ "$(cd "$TMP" && git log --oneline | wc -l | tr -d ' ')" = 2 ] && ok "commit kept locally" || fail "commit lost"
rm -rf "$TMP"

echo "# https remote with the token env unset: logged"
TMP=$(make_agent 'git-remote: https://127.0.0.1:1/o/p/_git/r
git-token-env: TEST_PUSH_TOKEN')
bash "$SCRIPTS/commit.sh" "$TMP" "t" >/dev/null 2>&1
events "$TMP" | grep -q 'TEST_PUSH_TOKEN is not set' && ok "names the missing variable" || fail "events: $(events "$TMP")"
rm -rf "$TMP"

echo "# https remote with a token: token used, never printed or logged"
TMP=$(make_agent 'git-remote: https://someorg@127.0.0.1:1/o/p/_git/r
git-token-env: TEST_PUSH_TOKEN')
OUT=$(TEST_PUSH_TOKEN=s3cr3t-tok bash "$SCRIPTS/commit.sh" "$TMP" "t" 2>&1)
[ "$(error_events "$TMP")" = 1 ] && ok "failed push logged" || fail "events: $(events "$TMP")"
! printf '%s' "$OUT$(events "$TMP")" | grep -q 's3cr3t-tok' && ok "token redacted" || fail "token leaked"
! printf '%s' "$OUT" | grep -q 'someorg@' && ok "username in URL replaced by token" || fail "kept URL username: $OUT"
rm -rf "$TMP"

echo "# invalid git-token-env: logged"
TMP=$(make_agent 'git-remote: https://127.0.0.1:1/r
git-token-env: "bad name"')
OUT=$(bash "$SCRIPTS/commit.sh" "$TMP" "t" 2>&1); RC=$?
[ "$RC" -eq 0 ] && events "$TMP" | grep -q 'not a valid variable name' && ok "rejected" || fail "rc=$RC events: $(events "$TMP")"
rm -rf "$TMP"

echo
echo "commit-remote: $OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
