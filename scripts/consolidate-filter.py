#!/usr/bin/env python3
"""Chronological timestamp filtering for consolidate-memory.sh (agent-portal#247 F3).

consolidate-memory.sh selected the journal entries and events "since the last
consolidation" by comparing ISO-8601 timestamps *lexicographically* in awk
(`entry_ts > ts`, `a[1] > last`, `$1 <= ts`). That is wrong across a UTC-offset
or DST change: a chronologically-later entry can sort lexicographically *earlier*
("...T07:00:00-07:00" = 14:00Z is later than "...T13:00:00+00:00" = 13:00Z, yet
"07" < "13" as strings), so recent journal/event entries get wrongly excluded
from the consolidation input fed to the LLM. Same root cause as Finding 2
(memory-index.py), but awk has no datetime parsing — so the comparison moves
into this stdlib-only helper that consolidate-memory.sh shells out to.

Reference timestamp is argv[2]; data is read from stdin; results are written one
line at a time to stdout. Modes:

  count-after <ref>     events JSONL in  -> count of lines whose "ts" > ref
  after <ref>           events JSONL in  -> the lines whose "ts" > ref
  journal-after <ref>   journal md in    -> lines of entries whose `### <ts>` > ref

"After" is always strict (`> ref`), matching the original awk semantics: the
"since last consolidation" window excludes an entry stamped exactly at the last
consolidation time.
"""

import re
import sys
from datetime import datetime, timezone

# First "ts":"..." on a line is the event timestamp (it is always the first
# field; .search returns the first match, so a summary that happens to contain
# the substring cannot shadow it). Mirrors the old awk -F'"ts":"' field split.
_TS_RE = re.compile(r'"ts"\s*:\s*"([^"]*)"')
# Journal header: `### <iso-ts> | <author> | <tag>`. The ts is the first
# non-space token after the marker and always starts with a digit (year).
_HEADER_RE = re.compile(r'^###\s+([0-9]\S*)')


def parse_ts(s):
    """ISO-8601 -> tz-aware UTC datetime for *chronological* comparison.

    Fail-safe: empty / unparseable timestamps return datetime.min (UTC) so they
    sort oldest — an entry with a junk timestamp is treated as old and excluded
    from the "since" window rather than crashing the consolidation. Mirrors
    parse_ts in memory-index.py (Finding 2)."""
    if not s:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _event_ts(line):
    m = _TS_RE.search(line)
    return m.group(1) if m else ""


def events_after(lines, ref):
    """Event JSONL lines whose "ts" field is chronologically after ref."""
    ref_dt = parse_ts(ref)
    return [ln for ln in lines if ln.strip() and parse_ts(_event_ts(ln)) > ref_dt]


def journal_after(lines, ref):
    """Journal markdown lines belonging to entries whose `### <ts> | ...` header
    is chronologically after ref.

    Replicates the awk state machine: a header line sets whether the following
    lines (up to the next header) are emitted; lines before the first header are
    not emitted."""
    ref_dt = parse_ts(ref)
    out, printing = [], False
    for ln in lines:
        m = _HEADER_RE.match(ln)
        if m:
            printing = parse_ts(m.group(1)) > ref_dt
        if printing:
            out.append(ln)
    return out


def main(argv):
    if len(argv) < 3:
        sys.stderr.write(
            "usage: consolidate-filter.py {count-after|after|journal-after} <ref-ts>\n")
        return 2
    mode, ref = argv[1], argv[2]
    lines = sys.stdin.read().splitlines()
    if mode == "count-after":
        print(len(events_after(lines, ref)))
    elif mode == "after":
        sys.stdout.write("".join(ln + "\n" for ln in events_after(lines, ref)))
    elif mode == "journal-after":
        sys.stdout.write("".join(ln + "\n" for ln in journal_after(lines, ref)))
    else:
        sys.stderr.write(f"unknown mode: {mode}\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
