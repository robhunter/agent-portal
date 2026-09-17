#!/bin/bash
# scripts/cycle-attempt.sh — what a retried wake keeps, and what it tells the
# attempt that follows. Sourced by wake.sh.
#
# The zero-work check reads events.jsonl, and an agent writes its events last,
# in its wrap-up. A cycle that dies after doing work therefore looks exactly
# like one that never woke (issue #301). Three consequences, all handled here.
#
# The retry must not destroy the dead attempt's transcript. `tee` to one
# per-cycle path truncates it, so the evidence about why the attempt died is
# overwritten by the retry responding to its death. Each attempt gets its own
# file; the first keeps the historical name.
#
# The retry must tell the next attempt that work may already exist. A fresh
# session that branches from main takes an unfinished branch with it on the
# first checkout, and nothing in the wake prompt says an earlier attempt ran.
#
# And a cycle whose wrap-up did happen should not be retried at all. The
# journal entry is the wrap-up's deliverable, so it is the second thing the
# zero-work check reads. Work in progress is deliberately not counted as a
# wrap-up: that is the case the retry exists for, and the note is what makes
# it safe.

# attempt_log_path <cycles-dir> <cycle-ts> <attempt>
#   Attempt 1 keeps <cycle-ts>.log so anything reading a cycle by its timestamp
#   still finds it; later attempts land beside it instead of over it.
attempt_log_path() {
  local cycles_dir="$1" cycle_ts="$2" attempt="$3"
  if [ "${attempt:-1}" -le 1 ] 2>/dev/null; then
    echo "$cycles_dir/${cycle_ts}.log"
  else
    echo "$cycles_dir/${cycle_ts}-attempt${attempt}.log"
  fi
}

# journal_lines <journals-dir> — total lines across the journal files, 0 if none.
journal_lines() {
  local journals_dir="$1"
  [ -d "$journals_dir" ] || { echo 0; return; }
  cat "$journals_dir"/*.md 2>/dev/null | wc -l | tr -d ' '
}

# wrap_up_happened <events-file> <events-before> <journals-dir> <journal-lines-before>
#   0 — the agent logged an event or wrote a journal entry; the wrap-up ran
#   1 — neither, so the harness exited before the agent finished
#
# Reading the journal as well as the events matters because the two are written
# together at the end of a cycle, and either one landing means the wrap-up ran.
# Retrying then costs a second full cycle and produces a duplicate entry.
wrap_up_happened() {
  local events_file="$1" events_before="$2" journals_dir="$3" journal_before="$4"
  local events_after journal_after
  events_after=$(wc -l < "$events_file" 2>/dev/null || echo 0)
  [ "${events_after:-0}" -gt "${events_before:-0}" ] 2>/dev/null && return 0
  journal_after=$(journal_lines "$journals_dir")
  [ "${journal_after:-0}" -gt "${journal_before:-0}" ] 2>/dev/null && return 0
  return 1
}

# dirty_workspaces <path>...
#   One "<path> (branch <name>, N uncommitted files)" line per workspace that is
#   off its default branch or holds uncommitted changes — the work in progress a
#   retry would otherwise walk into.
dirty_workspaces() {
  local path branch dirty
  for path in "$@"; do
    [ -d "$path/.git" ] || continue
    branch=$(git -C "$path" branch --show-current 2>/dev/null)
    dirty=$(git -C "$path" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [ "${dirty:-0}" != "0" ] || { [ -n "$branch" ] && [ "$branch" != "main" ] && [ "$branch" != "master" ]; }; then
      echo "$path (branch ${branch:-detached}, ${dirty:-0} uncommitted files)"
    fi
  done
}

# attempt_note <attempt> <previous-seconds> <previous-log> <workspace-path>...
#   The block appended to the wake prompt on a retry. Prints nothing on the
#   first attempt, so the caller can append it unconditionally.
attempt_note() {
  local attempt="$1" previous_seconds="$2" previous_log="$3"
  shift 3
  [ "${attempt:-1}" -gt 1 ] 2>/dev/null || return 0

  local minutes=$(( ${previous_seconds:-0} / 60 ))
  echo ""
  echo "# A previous attempt at this cycle already ran"
  echo ""
  echo "This is attempt $attempt. Attempt $((attempt - 1)) ran for ${minutes}m (${previous_seconds:-0}s)"
  echo "and exited without logging an event or writing a journal entry, which is why"
  echo "you were woken again. That does NOT mean it did nothing — the events and the"
  echo "journal are written last, so work it finished may already be on disk."
  echo ""
  echo "Before you branch or check out anything:"
  echo ""
  echo "- Run \`git status\` in your agent directory and in every workspace."
  echo "- Read the previous attempt's transcript: $previous_log"
  echo "- Check for branches and pull requests it may have opened."
  echo ""
  echo "Finish that work rather than starting it again, and write the journal entry"
  echo "for it — the cycle has no record of it yet."

  local dirty
  dirty=$(dirty_workspaces "$@")
  if [ -n "$dirty" ]; then
    echo ""
    echo "Workspaces that are not on a clean default branch right now:"
    echo ""
    echo "$dirty" | sed 's/^/- /'
  fi
}

# attempt_step <message> — routes through wake.sh's step() when there is one.
attempt_step() {
  if command -v step >/dev/null 2>&1; then step "$1"; else echo "$1"; fi
}

# attempt_event <type> <summary>
attempt_event() {
  [ -n "${FRAMEWORK_DIR:-}" ] || return 0
  bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" "$1" "$2" 2>/dev/null || true
}

# run_cycle_attempts — the harness invocation and its retries.
#
# Reads: HARNESS_CMD, HARNESS_EXTRA_FLAGS, WAKE_PROMPT_FILE, EVENTS_FILE,
#        JOURNALS_DIR, CYCLE_LOG_DIR, CYCLE_TS, MAX_RETRIES, AGENT_NAME,
#        WORKSPACE_PATHS (array), CYCLE_ATTEMPT_RETRY_DELAY.
# Sets:  HARNESS_EXIT, RETRY (attempts made), CYCLE_LOG (the last attempt's).
#
# fd 200 is the cycle lock; it is closed on every child so the harness cannot
# inherit it.
run_cycle_attempts() {
  local attempt_prompt="/tmp/agent-${AGENT_NAME:-agent}-attempt-note.txt"
  local attempt_seconds=0 attempt_start events_before journal_before

  RETRY=0
  HARNESS_EXIT=1
  CYCLE_LOG="$(attempt_log_path "$CYCLE_LOG_DIR" "$CYCLE_TS" 1)"

  while [ "$HARNESS_EXIT" -ne 0 ] && [ "$RETRY" -lt "${MAX_RETRIES:-2}" ]; do
    : > "$attempt_prompt"
    if [ "$RETRY" -gt 0 ]; then
      attempt_step "retrying harness (attempt $((RETRY+1)))"
      attempt_event retry "Retrying after failure (attempt $((RETRY+1)))"
      # Written before CYCLE_LOG moves on, so the note names the transcript of
      # the attempt that died rather than the empty one about to be created.
      attempt_note "$((RETRY+1))" "$attempt_seconds" "$CYCLE_LOG" \
        ${WORKSPACE_PATHS[@]+"${WORKSPACE_PATHS[@]}"} > "$attempt_prompt"
      CYCLE_LOG="$(attempt_log_path "$CYCLE_LOG_DIR" "$CYCLE_TS" "$((RETRY+1))")"
      attempt_step "attempt $((RETRY+1)) transcript at $CYCLE_LOG; attempt $RETRY kept"
      sleep "${CYCLE_ATTEMPT_RETRY_DELAY:-30}"
    fi

    events_before=$(wc -l < "$EVENTS_FILE" 2>/dev/null || echo 0)
    journal_before=$(journal_lines "$JOURNALS_DIR")
    attempt_start=$(date +%s)

    cat "$WAKE_PROMPT_FILE" "$attempt_prompt" 200>&- | $HARNESS_CMD $HARNESS_EXTRA_FLAGS \
      200>&- 2>&1 | tee 200>&- "$CYCLE_LOG"
    HARNESS_EXIT=${PIPESTATUS[1]}
    attempt_seconds=$(( $(date +%s) - attempt_start ))

    if [ "$HARNESS_EXIT" -eq 0 ] \
      && ! wrap_up_happened "$EVENTS_FILE" "$events_before" "$JOURNALS_DIR" "$journal_before"; then
      attempt_step "harness exited 0 but agent logged no event and wrote no journal entry after ${attempt_seconds}s — treating as failure (zero-work cycle)"
      attempt_event warning \
        "Harness exited 0 with no agent events after ${attempt_seconds}s; retrying (attempt $((RETRY+1)))"
      HARNESS_EXIT=98   # non-zero sentinel so the while loop retries
    fi

    RETRY=$((RETRY + 1))
  done
}
