#!/usr/bin/env python3
"""Regression tests for chronological timestamp handling in memory-index.py.

These cover the fix for Finding 2 of agent-portal#247: the incremental indexer
compared ISO-8601 timestamps lexicographically, which silently dropped entries
across a UTC-offset / DST change — a chronologically-later entry can sort
lexicographically-earlier (e.g. "...T07:00:00-07:00" = 14:00Z is later than
"...T13:00:00+00:00" = 13:00Z, yet "07..." < "13..." as strings), so the
incremental filter treated it as already-indexed and never embedded it.

Run locally (the memory scripts are not in CI — the python-tests job installs
only pytest+mitmproxy):

    scripts/memory-venv/bin/python scripts/memory-index-tz-test.py

No embedding model is loaded: memory-index imports without fastembed (that import
is lazy, inside main()), so these exercise the pure helpers and run instantly.
"""

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_module():
    spec = importlib.util.spec_from_file_location(
        "memory_index", Path(__file__).parent / "memory-index.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_lazy_import(mod):
    """Importing the module must not pull in fastembed, so the helpers below are
    testable without loading the embedding model."""
    assert "fastembed" not in sys.modules, \
        "fastembed must be imported lazily inside main(), not at module top"
    print("✓ module imports without loading fastembed")


def test_parse_ts_cross_offset(mod):
    """The documented failure: 07:00-07:00 (14:00Z) is chronologically later than
    13:00+00:00 (13:00Z), but sorts earlier as a string."""
    later = "2026-06-15T07:00:00-07:00"    # 14:00Z
    earlier = "2026-06-15T13:00:00+00:00"  # 13:00Z
    assert mod.parse_ts(later) > mod.parse_ts(earlier), "parse_ts ordered these wrong"
    assert not (later > earlier), "string comparison should be the opposite — that's the bug"
    print("✓ parse_ts orders entries across a UTC-offset change chronologically")


def test_parse_ts_dst(mod):
    """Guaranteed recurrence at the Nov 2026 PDT->PST fall-back (-07:00 -> -08:00)."""
    later = "2026-11-02T01:00:00-08:00"    # 09:00Z
    earlier = "2026-11-02T01:30:00-07:00"  # 08:30Z
    assert mod.parse_ts(later) > mod.parse_ts(earlier), "parse_ts ordered the DST pair wrong"
    assert not (later > earlier), "string comparison should be the opposite — that's the bug"
    print("✓ parse_ts handles the Nov DST fall-back boundary")


def test_parse_ts_equivalence_and_naive(mod):
    assert mod.parse_ts("2026-01-01T00:00:00Z") == mod.parse_ts("2026-01-01T00:00:00+00:00")
    # A naive (offset-less) timestamp is treated as UTC.
    assert mod.parse_ts("2026-01-01T00:00:00") == mod.parse_ts("2026-01-01T00:00:00+00:00")
    print("✓ parse_ts treats 'Z' as +00:00 and naive timestamps as UTC")


def test_parse_ts_failsafe(mod):
    floor = datetime.min.replace(tzinfo=timezone.utc)
    assert mod.parse_ts("") == floor
    assert mod.parse_ts("not-a-timestamp") == floor
    assert mod.parse_ts(None) == floor
    # Fail-safe entries sort oldest, so they are treated as new (re-indexed),
    # never silently dropped.
    assert mod.parse_ts("garbage") < mod.parse_ts("2026-01-01T00:00:00+00:00")
    print("✓ parse_ts is fail-safe (empty/garbage/None -> oldest, never dropped)")


def test_select_new_entries_watermark_trap(mod):
    """End-to-end trap: a +00:00 watermark must not hide chronologically-later
    -07:00 entries. This is the assertion that BITES if the filter reverts to
    lexicographic comparison."""
    entries = [
        {"timestamp": "2026-06-15T12:00:00+00:00"},  # 12:00Z — before watermark
        {"timestamp": "2026-06-15T13:00:00+00:00"},  # 13:00Z — equals watermark
        {"timestamp": "2026-06-15T07:00:00-07:00"},  # 14:00Z — later, sorts earlier
        {"timestamp": "2026-06-15T08:00:00-07:00"},  # 15:00Z — later, sorts earlier
    ]
    watermark = "2026-06-15T13:00:00+00:00"
    new, next_wm = mod.select_new_entries(entries, watermark)
    new_ts = [e["timestamp"] for e in new]
    assert new_ts == ["2026-06-15T07:00:00-07:00", "2026-06-15T08:00:00-07:00"], \
        f"cross-offset entries were dropped: {new_ts}"
    assert next_wm == "2026-06-15T08:00:00-07:00", f"watermark advanced wrong: {next_wm}"

    # Pin the bug being fixed: the OLD lexicographic filter dropped both entries.
    old_lex = [e["timestamp"] for e in entries if e["timestamp"] > watermark]
    assert old_lex == [], f"sanity: old lexicographic filter should drop all, got {old_lex}"
    print("✓ select_new_entries keeps cross-offset entries the old code silently dropped")


def test_select_new_entries_first_run_and_empty(mod):
    entries = [
        {"timestamp": "2026-06-15T13:00:00+00:00"},  # 13:00Z
        {"timestamp": "2026-06-15T07:00:00-07:00"},  # 14:00Z = chronological max
    ]
    # First run (empty watermark): everything is new; watermark = chronological max.
    new, wm = mod.select_new_entries(entries, "")
    assert len(new) == 2, f"first run should index all, got {len(new)}"
    assert wm == "2026-06-15T07:00:00-07:00", f"first-run watermark wrong: {wm}"
    # Re-run at that watermark: nothing newer, watermark unchanged.
    new2, wm2 = mod.select_new_entries(entries, wm)
    assert new2 == [], f"re-run should find nothing new, got {new2}"
    assert wm2 == wm, f"watermark should not move, got {wm2}"
    print("✓ select_new_entries handles the first run and the no-new-entries case")


def main():
    mod = load_module()
    test_lazy_import(mod)
    test_parse_ts_cross_offset(mod)
    test_parse_ts_dst(mod)
    test_parse_ts_equivalence_and_naive(mod)
    test_parse_ts_failsafe(mod)
    test_select_new_entries_watermark_trap(mod)
    test_select_new_entries_first_run_and_empty(mod)
    print("\n✅ All tz regression tests passed!")


if __name__ == "__main__":
    main()
