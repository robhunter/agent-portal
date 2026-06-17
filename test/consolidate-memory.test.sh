#!/bin/bash
# consolidate-memory.test.sh — Regression tests for chronological timestamp
# filtering in consolidate-memory.sh (agent-portal#247 Finding 3).
#
# The script picked the journal entries and events "since the last consolidation"
# with lexicographic ISO-8601 comparisons in awk. Across a UTC-offset / DST change
# a chronologically-later entry sorts lexicographically earlier
# ("...T07:00:00-07:00" = 14:00Z is later than "...T13:00:00+00:00" = 13:00Z, yet
# "07" < "13" as strings), so recent entries were wrongly excluded from the LLM
# consolidation input. The comparison now lives in scripts/consolidate-filter.py
# (stdlib python3, available on the CI runner), which these tests exercise.
#
# Each "after" assertion is a BITE point: the lexicographic logic gives the
# opposite answer on the cross-offset fixtures.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FILTER="$FRAMEWORK_DIR/scripts/consolidate-filter.py"

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

# The canonical cross-offset pair, reference = 13:00Z.
# A = 14:00Z written as 07:00-07:00 (chronologically AFTER 13:00Z, lexically before)
# B = 12:00Z written as +00:00       (chronologically BEFORE 13:00Z)
REF="2026-06-15T13:00:00+00:00"
A_EV='{"ts":"2026-06-15T07:00:00-07:00","type":"cycle_start","summary":"A 14:00Z"}'
B_EV='{"ts":"2026-06-15T12:00:00+00:00","type":"cycle_start","summary":"B 12:00Z"}'

echo "# consolidate-filter.py count-after — cross-offset"
N=$(printf '%s\n%s\n' "$A_EV" "$B_EV" | python3 "$FILTER" count-after "$REF")
[ "$N" = "1" ] && ok "counts the 14:00Z entry as after 13:00Z (got $N)" \
                || fail "expected 1 cycle after ref, got $N (lexicographic bug returns 0)"

echo "## both entries after a very old ref → counts 2"
N=$(printf '%s\n%s\n' "$A_EV" "$B_EV" | python3 "$FILTER" count-after "2000-01-01T00:00:00+00:00")
[ "$N" = "2" ] && ok "counts both after epoch-old ref" || fail "expected 2, got $N"

echo "## both entries before a future ref → counts 0"
N=$(printf '%s\n%s\n' "$A_EV" "$B_EV" | python3 "$FILTER" count-after "2030-01-01T00:00:00+00:00")
[ "$N" = "0" ] && ok "counts 0 when ref is in the future" || fail "expected 0, got $N"

echo "## empty input → counts 0 (no crash under set -e pipeline)"
N=$(printf '' | python3 "$FILTER" count-after "$REF")
[ "$N" = "0" ] && ok "empty stdin yields 0" || fail "expected 0 on empty input, got $N"

echo ""
echo "# consolidate-filter.py after — cross-offset"
A_WORK='{"ts":"2026-06-15T07:00:00-07:00","type":"work","summary":"A 14:00Z"}'
B_WORK='{"ts":"2026-06-15T12:00:00+00:00","type":"work","summary":"B 12:00Z"}'
OUT=$(printf '%s\n%s\n' "$A_WORK" "$B_WORK" | python3 "$FILTER" after "$REF")
echo "$OUT" | grep -q "A 14:00Z" && ok "emits the 14:00Z event (after ref)" \
                                 || fail "14:00Z event wrongly dropped (lexicographic bug)"
echo "$OUT" | grep -q "B 12:00Z" && fail "12:00Z event should be excluded" \
                                 || ok "excludes the 12:00Z event (before ref)"

echo "## ref exactly equal to an entry ts → strict after excludes it"
OUT=$(printf '%s\n' "$B_WORK" | python3 "$FILTER" after "2026-06-15T12:00:00+00:00")
[ -z "$OUT" ] && ok "entry stamped exactly at ref is excluded (strict >)" \
              || fail "entry at ref should be excluded, got: $OUT"

echo "## same offset across ref → ordinary case still correct"
E1='{"ts":"2026-06-15T10:00:00+00:00","type":"work","summary":"E1 before"}'
E2='{"ts":"2026-06-15T16:00:00+00:00","type":"work","summary":"E2 after"}'
OUT=$(printf '%s\n%s\n' "$E1" "$E2" | python3 "$FILTER" after "$REF")
echo "$OUT" | grep -q "E2 after" && ok "keeps the later same-offset entry" || fail "E2 wrongly dropped"
echo "$OUT" | grep -q "E1 before" && fail "E1 should be excluded" || ok "drops the earlier same-offset entry"

echo "## malformed line (no ts) is treated as old and excluded (fail-safe)"
OUT=$(printf '%s\n%s\n' "$A_WORK" 'garbage with no ts field' | python3 "$FILTER" after "$REF")
echo "$OUT" | grep -q "garbage" && fail "no-ts line should be excluded from the since-window" \
                                || ok "no-ts line excluded (parse_ts fail-safe → datetime.min)"

echo ""
echo "# consolidate-filter.py journal-after — stateful + cross-offset"
JOURNAL=$(cat <<'EOF'
### 2026-06-15T07:00:00-07:00 | coder | cycle
body line one of A (14:00Z, after ref)
body line two of A
### 2026-06-15T12:00:00+00:00 | coder | cycle
body of B (12:00Z, before ref)
EOF
)
OUT=$(printf '%s\n' "$JOURNAL" | python3 "$FILTER" journal-after "$REF")
echo "$OUT" | grep -q "body line one of A" && ok "keeps the 14:00Z entry header+body" \
                                           || fail "14:00Z journal entry wrongly dropped (lexicographic bug)"
echo "$OUT" | grep -q "body line two of A" && ok "keeps ALL body lines until the next header" \
                                           || fail "multi-line body not fully emitted"
echo "$OUT" | grep -q "body of B" && fail "12:00Z entry should be excluded" \
                                  || ok "excludes the 12:00Z entry"

echo "## leading content before the first header is not emitted"
LEAD=$(cat <<'EOF'
# Journal preamble — no header yet
### 2026-06-15T07:00:00-07:00 | coder | cycle
kept body
EOF
)
OUT=$(printf '%s\n' "$LEAD" | python3 "$FILTER" journal-after "$REF")
echo "$OUT" | grep -q "preamble" && fail "pre-header lines should not be emitted" \
                                 || ok "pre-header lines excluded (matches awk state machine)"
echo "$OUT" | grep -q "kept body" && ok "post-header body still emitted" || fail "kept body missing"

echo "## Z-suffixed header timestamp parses (not only ±hh:mm offsets)"
ZJOURNAL=$(cat <<'EOF'
### 2026-06-15T16:00:00Z | system | output
kept Z entry
EOF
)
OUT=$(printf '%s\n' "$ZJOURNAL" | python3 "$FILTER" journal-after "$REF")
echo "$OUT" | grep -q "kept Z entry" && ok "Z-suffixed header (16:00Z > 13:00Z) kept" || fail "Z header dropped"

echo ""
echo "# integration — consolidate-memory.sh actually routes through the helper"
grep -q 'consolidate-filter.py' "$FRAMEWORK_DIR/scripts/consolidate-memory.sh" \
  && ok "consolidate-memory.sh shells out to consolidate-filter.py" \
  || fail "consolidate-memory.sh no longer calls consolidate-filter.py (integration lost)"
# The old buggy awk timestamp comparisons must be gone.
grep -q 'entry_ts > ts' "$FRAMEWORK_DIR/scripts/consolidate-memory.sh" \
  && fail "lexicographic awk journal compare still present" \
  || ok "lexicographic awk journal compare removed"

echo ""
echo "# Results: $((OK+FAIL)) tests, $OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
