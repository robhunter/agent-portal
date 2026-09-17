#!/bin/bash
# test/cycle-attempt.test.sh — a retry must not destroy what the attempt before
# it left, and must say that the attempt happened.
#
# Regression test for issue #301: a 27-minute cycle was retried as "zero-work"
# because the agent writes its events last, and the retry's `tee` truncated the
# dead attempt's transcript to 0 bytes — destroying the only record of what it
# had done, which included eight modified files on an unmerged branch.
#
# Run directly or via `npm test` (the test/*.test.sh loop).

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ok - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL - $1"; }
check() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (got '$2', want '$3')"; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing '$3')";; esac; }
excludes() { case "$2" in *"$3"*) bad "$1 (found '$3')";; *) ok "$1";; esac; }

echo "# cycle-attempt.sh"

. "$SCRIPT_DIR/scripts/cycle-attempt.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── each attempt writes its own transcript ──

CYCLES="$TMP/cycles"
mkdir -p "$CYCLES"

check "the first attempt keeps the historical per-cycle name" \
  "$(attempt_log_path "$CYCLES" 20260916-0600 1)" "$CYCLES/20260916-0600.log"
check "a retry lands beside it, not on it" \
  "$(attempt_log_path "$CYCLES" 20260916-0600 2)" "$CYCLES/20260916-0600-attempt2.log"
check "a third attempt gets its own name too" \
  "$(attempt_log_path "$CYCLES" 20260916-0600 3)" "$CYCLES/20260916-0600-attempt3.log"

# The defect itself: two attempts, `tee`ing in turn, must leave two transcripts.
FIRST="$(attempt_log_path "$CYCLES" 20260916-0600 1)"
echo "27 minutes of work" | tee "$FIRST" > /dev/null
SECOND="$(attempt_log_path "$CYCLES" 20260916-0600 2)"
echo "the retry" | tee "$SECOND" > /dev/null
check "the dead attempt's transcript survives the retry" "$(cat "$FIRST")" "27 minutes of work"
check "and the retry's transcript is its own" "$(cat "$SECOND")" "the retry"

# ── what counts as the cycle having wrapped up ──

EVENTS="$TMP/events.jsonl"
JOURNALS="$TMP/journals"
mkdir -p "$JOURNALS"
printf '{"type":"cycle_start"}\n' > "$EVENTS"
printf '### header\n' > "$JOURNALS/2026-09.md"

EVENTS_BEFORE=$(wc -l < "$EVENTS")
JOURNAL_BEFORE=$(journal_lines "$JOURNALS")

wrap_up_happened "$EVENTS" "$EVENTS_BEFORE" "$JOURNALS" "$JOURNAL_BEFORE"
check "an attempt that logged nothing has not wrapped up" "$?" "1"

printf '{"type":"work"}\n' >> "$EVENTS"
wrap_up_happened "$EVENTS" "$EVENTS_BEFORE" "$JOURNALS" "$JOURNAL_BEFORE"
check "an attempt that logged an event has" "$?" "0"

# The journal is the wrap-up's deliverable, so it counts on its own — an agent
# that journalled and died before log-event.sh should not be run a second time.
printf '{"type":"cycle_start"}\n' > "$EVENTS"
EVENTS_BEFORE=$(wc -l < "$EVENTS")
printf '\n### 2026-09-16 | coder | cycle\nShipped it.\n' >> "$JOURNALS/2026-09.md"
wrap_up_happened "$EVENTS" "$EVENTS_BEFORE" "$JOURNALS" "$JOURNAL_BEFORE"
check "an attempt that wrote a journal entry and no event has" "$?" "0"

# A journal directory that does not exist yet is not a crash.
wrap_up_happened "$EVENTS" "$EVENTS_BEFORE" "$TMP/no-such-dir" 0
check "a missing journal directory reads as no wrap-up" "$?" "1"
check "and its line count is zero" "$(journal_lines "$TMP/no-such-dir")" "0"

# ── the note the retry carries ──

check "the first attempt is told nothing" "$(attempt_note 1 0 "$FIRST")" ""

NOTE="$(attempt_note 2 1655 "$FIRST")"
contains "the note says which attempt this is" "$NOTE" "This is attempt 2"
contains "the note gives the dead attempt's duration in minutes" "$NOTE" "27m (1655s)"
contains "the note names the transcript to read" "$NOTE" "$FIRST"
contains "the note says to run git status before branching" "$NOTE" "git status"
contains "the note says the work may already exist" "$NOTE" "may already be on disk"
contains "the note asks for the journal entry the cycle still lacks" "$NOTE" "journal entry"

# ── the workspaces the retry would walk into ──

WS="$TMP/workspace"
CLEAN="$TMP/clean"
for repo in "$WS" "$CLEAN"; do
  mkdir -p "$repo"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email t@t; git -C "$repo" config user.name t
  echo one > "$repo/file.txt"
  git -C "$repo" add -A; git -C "$repo" commit -qm first
done

check "a workspace on a clean main is not reported" "$(dirty_workspaces "$CLEAN")" ""

git -C "$WS" checkout -q -b 1740-half-finished
echo two > "$WS/file.txt"
REPORT="$(dirty_workspaces "$WS" "$CLEAN")"
contains "a workspace on a feature branch is reported" "$REPORT" "$WS"
contains "with the branch it is on" "$REPORT" "1740-half-finished"
contains "and its uncommitted file count" "$REPORT" "1 uncommitted files"
excludes "and the clean workspace is still not" "$REPORT" "$CLEAN"

check "a path that is not a git repo is skipped" "$(dirty_workspaces "$TMP/cycles")" ""

NOTE="$(attempt_note 2 1655 "$FIRST" "$WS" "$CLEAN")"
contains "the note carries the dirty workspace into the prompt" "$NOTE" "1740-half-finished"

# ── the loop wake.sh actually runs, against a stub harness ──

AGENT_NAME="cycle-attempt-test"
FRAMEWORK_DIR=""            # no log-event.sh side effects in the fixture
HARNESS_EXTRA_FLAGS=""
CYCLE_ATTEMPT_RETRY_DELAY=0
MAX_RETRIES=2
CYCLE_TS=20260916-0600
WORKSPACE_PATHS=("$WS")

# The stub reads the prompt on stdin, writes it where the test can read it, and
# behaves however STUB_MODE says — exiting 0 having written nothing is the
# failure this whole file is about.
STUB="$TMP/harness.sh"
cat > "$STUB" <<'STUBEOF'
#!/bin/bash
cat > "$STUB_PROMPT_SEEN.$(cat "$STUB_COUNTER")"
echo "transcript of attempt $(cat "$STUB_COUNTER")"
echo $(( $(cat "$STUB_COUNTER") + 1 )) > "$STUB_COUNTER"
case "$STUB_MODE" in
  silent) exit 0 ;;
  journal) printf '\n### entry\ntext\n' >> "$STUB_JOURNALS/2026-09.md"; exit 0 ;;
  event)   printf '{"type":"work"}\n' >> "$STUB_EVENTS"; exit 0 ;;
  wrap-up-on-second)
    [ "$(cat "$STUB_COUNTER")" -gt 2 ] && printf '{"type":"work"}\n' >> "$STUB_EVENTS"
    exit 0 ;;
esac
STUBEOF
chmod +x "$STUB"
HARNESS_CMD="bash $STUB"

export STUB_COUNTER="$TMP/counter" STUB_PROMPT_SEEN="$TMP/prompt-seen"
export STUB_EVENTS="$EVENTS" STUB_JOURNALS="$JOURNALS" STUB_MODE=silent

run_loop() {
  echo 1 > "$STUB_COUNTER"
  rm -f "$TMP/prompt-seen".* "$CYCLES"/20260916-0600*.log
  printf '{"type":"cycle_start"}\n' > "$EVENTS"
  printf '### header\n' > "$JOURNALS/2026-09.md"
  EVENTS_FILE="$EVENTS" JOURNALS_DIR="$JOURNALS" \
    WAKE_PROMPT_FILE="$TMP/wake-prompt.txt" CYCLE_LOG_DIR="$CYCLES" \
    run_cycle_attempts > /dev/null 2>&1
}

echo "the standing wake prompt" > "$TMP/wake-prompt.txt"

STUB_MODE=silent
run_loop
check "a harness that exits 0 having written nothing is retried" "$RETRY" "2"
check "and the cycle is reported as failed, not as a clean exit" "$HARNESS_EXIT" "98"
check "attempt 1's transcript is still on disk" \
  "$(cat "$CYCLES/20260916-0600.log" 2>/dev/null)" "transcript of attempt 1"
check "and attempt 2's is beside it" \
  "$(cat "$CYCLES/20260916-0600-attempt2.log" 2>/dev/null)" "transcript of attempt 2"
contains "attempt 1 gets the standing prompt" "$(cat "$TMP/prompt-seen.1")" "the standing wake prompt"
excludes "and is not told about an attempt that has not happened" \
  "$(cat "$TMP/prompt-seen.1")" "This is attempt"
contains "attempt 2 still gets the standing prompt" "$(cat "$TMP/prompt-seen.2")" "the standing wake prompt"
contains "and is told an earlier attempt ran" "$(cat "$TMP/prompt-seen.2")" "This is attempt 2"
contains "and where its transcript is" "$(cat "$TMP/prompt-seen.2")" "$CYCLES/20260916-0600.log"
contains "and which workspace it left work in" "$(cat "$TMP/prompt-seen.2")" "1740-half-finished"

STUB_MODE=event
run_loop
check "a harness whose agent logged an event is not retried" "$RETRY" "1"
check "and the cycle is reported as a clean exit" "$HARNESS_EXIT" "0"

STUB_MODE=journal
run_loop
check "a harness whose agent journalled and logged no event is not retried" "$RETRY" "1"
check "and that cycle is a clean exit too" "$HARNESS_EXIT" "0"

STUB_MODE=wrap-up-on-second
run_loop
check "a retry that does wrap up ends the loop" "$RETRY" "2"
check "and the cycle is reported as a clean exit" "$HARNESS_EXIT" "0"
check "with both transcripts kept" \
  "$(cat "$CYCLES/20260916-0600.log" 2>/dev/null)" "transcript of attempt 1"

echo ""
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
