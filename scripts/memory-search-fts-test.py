#!/usr/bin/env python3
"""Regression tests for FTS5 query sanitization in memory-search.py.

These cover Finding 6 of agent-portal#247: memory-search.py passed the raw user
query straight into an FTS5 ``MATCH``. FTS5's query syntax treats ":", "-", "(",
")", "*", "^", double-quotes and bare AND/OR/NOT as operators, so any such
character raised sqlite3.OperationalError — which the surrounding ``except
Exception: pass`` silently swallowed, dropping the keyword half of the hybrid
score. Since most of this agent's recall queries name hyphenated repos/scripts
(agent-portal, memory-index, log-event, health-check), keyword matching was
silently disabled on the majority of wake-up searches.

build_fts_query reduces the query to space-joined quoted literal terms so it
always parses, preserving the previous implicit-AND matching semantics for
queries that already worked.

Run locally (the memory scripts are not in CI — the python-tests job installs
only pytest+mitmproxy):

    scripts/memory-venv/bin/python scripts/memory-search-fts-test.py

The build_fts_query tests are pure stdlib; the executes-against-fts5 tests build
an in-memory FTS5 table. No embedding model is loaded — fastembed is imported
lazily inside main(), so importing the module is instant.
"""

import importlib.util
import re
import sqlite3
import sys
from pathlib import Path


def load_module():
    spec = importlib.util.spec_from_file_location(
        "memory_search", Path(__file__).parent / "memory-search.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# The realistic wake-up queries that motivated the fix. All but the first two
# contain an FTS5 operator character and raise on a raw MATCH.
REALISTIC_QUERIES = [
    "cost reporting fidelity",      # plain — already worked
    "security audit npm",           # plain — already worked
    "framework-update rollback",    # hyphen
    "memory-index timestamp",       # hyphen
    "cost: fidelity",               # ":" column-filter syntax
    "health-check DATA_DIR",        # hyphen + underscore
    "security audit (npm)",         # parens
    "log-event.sh JSON",            # hyphen + dot
    "agent-portal vs contentbot",   # hyphen
    "what did I ship?",             # "?"
    "NOT shipping",                 # bare NOT operator
]


def test_lazy_import(mod):
    """Importing the module must not pull in fastembed, so the pure helper below
    is testable without loading the embedding model."""
    assert "fastembed" not in sys.modules, \
        "fastembed must be imported lazily inside main(), not at module top"
    print("✓ module imports without loading fastembed")


def test_quotes_each_token(mod):
    assert mod.build_fts_query("framework-update rollback") == '"framework" "update" "rollback"'
    assert mod.build_fts_query("cost reporting fidelity") == '"cost" "reporting" "fidelity"'
    # Underscores are word characters and stay within a single token (matching how
    # the unicode61 tokenizer indexes DATA_DIR).
    assert mod.build_fts_query("health-check DATA_DIR") == '"health" "check" "DATA_DIR"'
    print("✓ build_fts_query wraps each word token in double quotes")


def test_strips_operator_characters(mod):
    """No FTS5 operator/special character may survive into the output except the
    wrapping quotes — that is what makes the MATCH parse-safe."""
    for q in REALISTIC_QUERIES:
        out = mod.build_fts_query(q)
        assert out is not None, f"unexpected None for {q!r}"
        # Strip the wrapping quotes and the joining spaces; what remains must be
        # word characters only — no ":", "-", "(", ")", "*", "?", "." leaked.
        bare = out.replace('"', "").replace(" ", "")
        assert re.fullmatch(r"\w*", bare), f"operator characters leaked from {q!r}: {out!r}"
        for ch in ':-().?*^':
            assert ch not in out, f"operator {ch!r} leaked from {q!r}: {out!r}"
    print("✓ build_fts_query strips every FTS5 operator character")


def test_empty_and_punctuation_only(mod):
    assert mod.build_fts_query("") is None
    assert mod.build_fts_query("   ") is None
    assert mod.build_fts_query("???") is None
    assert mod.build_fts_query("-- () : *") is None
    print("✓ build_fts_query returns None when there is nothing to match on")


def test_quote_in_query_is_neutralized(mod):
    """A double-quote in the query must not break out of the quoting — the word
    tokenizer drops it, so it can never reach FTS5 unescaped."""
    out = mod.build_fts_query('say "hello" now')
    assert out == '"say" "hello" "now"', out
    assert out.count('"') == 6, f"stray quotes would break MATCH: {out!r}"
    print("✓ build_fts_query neutralizes embedded double-quotes")


def _make_fts():
    conn = sqlite3.connect(":memory:")
    # Default tokenizer (unicode61) — same as the real entries_fts table.
    conn.execute("CREATE VIRTUAL TABLE fts USING fts5(content)")
    conn.executemany("INSERT INTO fts(content) VALUES (?)", [
        ("the framework-update rollback path and its checkout logic",),
        ("memory-index timestamp comparison across a DST boundary",),
        ("health-check DATA_DIR resolution for the hosted layout",),
        ("security audit of npm advisories in the portal",),
        ("log-event.sh JSON escaping prevents corruption",),
        ("agent-portal and contentbot cycle notes about shipping",),
    ])
    return conn


def test_raw_query_throws_but_sanitized_executes(mod):
    """The bite + the fix, hermetically: the raw operator queries raise
    OperationalError (the bug), while the sanitized form always executes."""
    conn = _make_fts()
    sql = "SELECT rowid FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 20"

    raw_threw = 0
    for q in REALISTIC_QUERIES:
        # Sanitized form must never raise.
        mq = mod.build_fts_query(q)
        assert mq is not None
        conn.execute(sql, (mq,)).fetchall()  # raises if the fix is wrong
        # Track which raw queries throw (pins that the bug is real for these).
        try:
            conn.execute(sql, (q,)).fetchall()
        except sqlite3.OperationalError:
            raw_threw += 1
    assert raw_threw >= 8, \
        f"expected the raw operator queries to throw (the bug); only {raw_threw} did"
    conn.close()
    print(f"✓ sanitized queries all execute; {raw_threw}/{len(REALISTIC_QUERIES)} raw queries throw (the bug)")


def test_sanitized_query_actually_matches(mod):
    """Sanitizing must not just avoid errors — it must still find the content."""
    conn = _make_fts()
    sql = "SELECT rowid FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 20"
    # A hyphenated query that previously threw now matches its indexed row.
    hits = conn.execute(sql, (mod.build_fts_query("framework-update rollback"),)).fetchall()
    assert len(hits) == 1, f"expected the rollback row, got {hits}"
    hits = conn.execute(sql, (mod.build_fts_query("agent-portal contentbot"),)).fetchall()
    assert len(hits) == 1, f"expected the agent-portal/contentbot row, got {hits}"
    conn.close()
    print("✓ sanitized hyphenated queries match the indexed content")


def test_behavior_preserved_for_plain_queries(mod):
    """For a query that already parsed, the sanitized form returns the same rows
    (implicit-AND semantics preserved)."""
    conn = _make_fts()
    sql = "SELECT rowid FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT 20"
    for q in ("security audit npm", "cost reporting fidelity", "shipping"):
        raw = conn.execute(sql, (q,)).fetchall()
        san = conn.execute(sql, (mod.build_fts_query(q),)).fetchall()
        assert raw == san, f"sanitizing changed results for plain query {q!r}: {raw} != {san}"
    conn.close()
    print("✓ plain queries return identical rows after sanitizing (behavior preserved)")


def main():
    mod = load_module()
    test_lazy_import(mod)
    test_quotes_each_token(mod)
    test_strips_operator_characters(mod)
    test_empty_and_punctuation_only(mod)
    test_quote_in_query_is_neutralized(mod)
    test_raw_query_throws_but_sanitized_executes(mod)
    test_sanitized_query_actually_matches(mod)
    test_behavior_preserved_for_plain_queries(mod)
    print("\n✅ All FTS sanitization tests passed!")


if __name__ == "__main__":
    main()
