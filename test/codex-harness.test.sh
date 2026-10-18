#!/bin/bash
# codex-harness.test.sh — scripts/codex-harness.sh against a stub `codex` binary:
# argument shape, stdout/stderr split, auth gate, .mcp.json translation and
# swallowed-error detection.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$FRAMEWORK_DIR/scripts/codex-harness.sh"

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

TMP=$(mktemp -d -t codex-harness-XXXXXX)
AGENT="$TMP/agent"
mkdir -p "$AGENT" "$TMP/home"
echo '{"tokens":{}}' > "$TMP/home/auth.json"

# Stub: records its args and stdin, prints a final message on stdout and
# progress on stderr, and exits with $STUB_RC after printing $STUB_ERR.
cat > "$TMP/codex" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" > "$STUB_DIR/args"
cat > "$STUB_DIR/stdin"
printf 'call\n' >> "$STUB_DIR/calls"
[ -z "${STUB_CYCLE_EVENTS:-}" ] || printf '{"type":"work"}\n' >> "$STUB_CYCLE_EVENTS"
echo "progress line" >&2
[ -n "${STUB_ERR:-}" ] && echo "$STUB_ERR" >&2
JSON=0
FINAL=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --json) JSON=1 ;;
    -o|--output-last-message) shift; FINAL="$1" ;;
  esac
  shift
done
[ -n "$FINAL" ] && printf '%s\n' "final message" > "$FINAL"
if [ "$JSON" -eq 1 ]; then
  DEFAULT_EVENTS='{"type":"turn.completed"}'
  printf '%s\n' "${STUB_EVENTS-$DEFAULT_EVENTS}"
else
  echo "final message"
fi
exit "${STUB_RC:-0}"
STUB
chmod +x "$TMP/codex"

run() {
  (cd "$AGENT" && echo "the prompt" | CODEX_BIN="$TMP/codex" CODEX_HOME="$TMP/home" STUB_DIR="$TMP" \
    bash "$SCRIPT" "$@" >"$TMP/out" 2>"$TMP/err")
}

echo "# happy path"
STUB_RC=0 STUB_ERR="" run --model gpt-test && RC=0 || RC=$?
[ "$RC" -eq 0 ] && ok "exit 0" || fail "exit $RC"
[ "$(cat "$TMP/out")" = "final message" ] && ok "stdout is only the final message" || fail "stdout: $(cat "$TMP/out")"
grep -q "progress line" "$TMP/err" && ok "progress goes to stderr" || fail "stderr: $(cat "$TMP/err")"
[ "$(cat "$TMP/stdin")" = "the prompt" ] && ok "prompt reaches codex on stdin" || fail "stdin: $(cat "$TMP/stdin")"
[ "$(head -1 "$TMP/args")" = "exec" ] && ok "runs codex exec" || fail "args: $(tr '\n' ' ' < "$TMP/args")"
grep -qx -- "--dangerously-bypass-approvals-and-sandbox" "$TMP/args" && ok "sandbox bypass flag" || fail "missing bypass flag"
grep -qx -- 'model_reasoning_effort=high' "$TMP/args" && ok "high reasoning effort" || fail "missing effort"
grep -qx -- "$AGENT" "$TMP/args" && ok "-C points at the agent dir" || fail "agent dir not passed"
[ "$(tail -1 "$TMP/args")" = "-" ] && ok "reads the prompt from stdin (-)" || fail "last arg: $(tail -1 "$TMP/args")"
grep -qx -- "gpt-test" "$TMP/args" && ok "extra flags passed through" || fail "extra flags missing"
grep -q "mcp_servers" "$TMP/args" && fail "mcp overrides without .mcp.json" || ok "no mcp overrides without .mcp.json"

echo "# .mcp.json translation"
cat > "$AGENT/.mcp.json" <<'MCP'
{"mcpServers":{"playwright":{"command":"npx","args":["@playwright/mcp@latest","--headless"],"env":{"FOO":"bar"}},"remote":{"type":"http","url":"https://example.com"}}}
MCP
STUB_RC=0 run && RC=0 || RC=$?
grep -qx -- 'mcp_servers.playwright.command="npx"' "$TMP/args" && ok "command override" || fail "args: $(tr '\n' ' ' < "$TMP/args")"
grep -qx -- 'mcp_servers.playwright.args=\["@playwright/mcp@latest","--headless"\]' "$TMP/args" && ok "args override" || fail "args override missing"
grep -qx -- 'mcp_servers.playwright.env={"FOO"="bar"}' "$TMP/args" && ok "env override" || fail "env override missing"
grep -q "mcp_servers.remote" "$TMP/args" && fail "non-stdio server translated" || ok "non-stdio servers skipped"
rm -f "$AGENT/.mcp.json"

echo "# failures"
STUB_RC=0 STUB_ERR="ERROR: usage limit reached" STUB_EVENTS='{"type":"turn.failed","error":{"message":"usage limit reached"}}' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "swallowed error turns exit 0 into 1" || fail "exit $RC"
STUB_RC=0 STUB_ERR="note: rate limits look fine" run && RC=0 || RC=$?
[ "$RC" -eq 0 ] && ok "benign text does not trip the detector" || fail "exit $RC"
STUB_RC=7 run && RC=0 || RC=$?
[ "$RC" -eq 7 ] && ok "codex's own exit code passes through" || fail "exit $RC"

echo "# lifecycle events, independent of transcript text"
STUB_RC=0 STUB_ERR='The previous run reported usage limit reached; it recovered.' run && RC=0 || RC=$?
[ "$RC" -eq 0 ] && ok "quoted historical error is not a failure" || fail "exit $RC"
STUB_RC=0 STUB_ERR='ERROR: usage limit reached' STUB_EVENTS='{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"ERROR: usage limit reached","exit_code":1}}
{"type":"item.completed","item":{"type":"agent_message","text":"The source contains stream disconnected and unexpected error occurred"}}
{"type":"turn.completed"}' run && RC=0 || RC=$?
[ "$RC" -eq 0 ] && ok "completed turn survives error phrases in tool output and agent messages" || fail "exit $RC"
[ "$(cat "$TMP/out")" = "final message" ] && ok "event stream does not leak to final-message stdout" || fail "stdout: $(cat "$TMP/out")"
grep -qx -- '--json' "$TMP/args" && ok "requests structured lifecycle events" || fail "missing --json"
STUB_RC=0 STUB_EVENTS='{"type":"error","message":"stream disconnected; reconnecting"}
{"type":"turn.completed"}' run && RC=0 || RC=$?
[ "$RC" -eq 0 ] && ok "recovered error followed by completion succeeds" || fail "exit $RC"
STUB_RC=0 STUB_EVENTS='{"type":"turn.failed","error":{"message":"request rejected"}}' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "failed turn is detected without a known error phrase" || fail "exit $RC"
STUB_RC=0 STUB_EVENTS='{"type":"turn.completed"}
{"type":"turn.failed","error":{"message":"request rejected"}}' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "later failure overrides earlier completion" || fail "exit $RC"
STUB_RC=0 STUB_EVENTS='{"type":"turn.completed"}
{"type":"error","message":"connection lost"}' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "unrecovered error after completion fails" || fail "exit $RC"
STUB_RC=0 STUB_EVENTS='{"type":"turn.completed"}
{"type":"turn.started"}' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "unfinished later turn fails" || fail "exit $RC"
STUB_RC=0 STUB_EVENTS='{"type":"turn.started"}
{"type":"item.completed","item":{"type":"agent_message","text":"done"}}' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "truncated stream without completion fails" || fail "exit $RC"
STUB_RC=0 STUB_EVENTS='' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "empty event stream fails" || fail "exit $RC"
STUB_RC=0 STUB_EVENTS='not json
{"type":"turn.completed"}' run && RC=0 || RC=$?
[ "$RC" -eq 1 ] && ok "malformed event stream fails" || fail "exit $RC"

echo "# wake retry integration"
rm "$TMP/calls"
if (
  cd "$AGENT"
  source "$FRAMEWORK_DIR/scripts/cycle-attempt.sh"
  CYCLE_LOG_DIR="$TMP/cycles"
  CYCLE_TS="test"
  AGENT_NAME="test"
  WAKE_PROMPT_FILE="$TMP/prompt"
  EVENTS_FILE="$TMP/events.jsonl"
  JOURNALS_DIR="$TMP/journals"
  HARNESS_CMD="bash $SCRIPT"
  HARNESS_EXTRA_FLAGS=""
  MAX_RETRIES=2
  mkdir -p "$CYCLE_LOG_DIR" "$JOURNALS_DIR"
  echo 'the prompt' > "$WAKE_PROMPT_FILE"
  : > "$EVENTS_FILE"
  export CODEX_BIN="$TMP/codex" CODEX_HOME="$TMP/home" STUB_DIR="$TMP"
  export STUB_RC=0 STUB_ERR='The source mentions usage limit reached.'
  export STUB_CYCLE_EVENTS="$EVENTS_FILE" CYCLE_ATTEMPT_RETRY_DELAY=0
  run_cycle_attempts
  [ "$HARNESS_EXIT" -eq 0 ] && [ "$RETRY" -eq 1 ]
) > "$TMP/retry.log" 2>&1; then
  ok "wake accepts completed work without retrying quoted error text"
else
  fail "wake retried completed work: $(tail -4 "$TMP/retry.log")"
fi
[ "$(wc -l < "$TMP/calls")" -eq 1 ] && ok "completed cycle invokes Codex once" || fail "Codex invoked $(wc -l < "$TMP/calls") times"

rm "$TMP/home/auth.json"
STUB_RC=0 run && RC=0 || RC=$?
[ "$RC" -eq 2 ] && grep -q "codex login --device-auth" "$TMP/err" && ok "missing login exits 2 with instructions" || fail "exit $RC"

rm -rf "$TMP"

echo ""
echo "# Results: $((OK+FAIL)) tests, $OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
