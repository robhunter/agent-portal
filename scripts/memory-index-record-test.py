#!/usr/bin/env python3
"""Exercise source-record retention and recovery through the real index CLI."""

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import textwrap


SCRIPT = Path(__file__).with_name("memory-index.py")
FIELDS = "source, timestamp, author, tag, content"
STAMP = "2026-10-23T20:00:00-07:00"
LATER = "2026-10-23T21:00:00-07:00"


def main():
    spec = importlib.util.spec_from_file_location("memory_index", SCRIPT)
    indexer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(indexer)
    db = indexer.init_db(":memory:")
    record = dict(source="journal", timestamp=STAMP, author=None, tag="work", content="same text")
    db.execute(f"INSERT INTO entries ({FIELDS}) VALUES (?, ?, ?, ?, ?)", indexer.record_key(record))
    assert indexer.is_duplicate(db, record)
    for field, value in (("source", "event"), ("timestamp", LATER), ("author", ""),
                         ("tag", "error"), ("content", "same Text")):
        assert not indexer.is_duplicate(db, {**record, field: value}), field
    db.close()
    print("✓ every source-record field distinguishes otherwise identical metadata, including NULL")

    with tempfile.TemporaryDirectory(prefix="memory-record-test-") as tmp:
        root = Path(tmp)
        data = root / "data"
        (data / "journals").mkdir(parents=True)
        (data / "logs").mkdir()
        (data / "memory").mkdir()
        model = root / "model"
        model.mkdir()
        (model / "fastembed.py").write_text(textwrap.dedent("""\
            import os
            import numpy as np
            from pathlib import Path

            class TextEmbedding:
                def __init__(self, **kwargs):
                    pass

                def embed(self, texts):
                    for text in texts:
                        if os.environ.get("FAIL_EMBED"):
                            raise RuntimeError("fixture embedding failure")
                        if os.environ.get("SHORT_EMBED"):
                            return
                        with Path(os.environ["EMBED_LOG"]).open("a") as output:
                            output.write(text + "\\n")
                        yield np.ones(384)
            """))
        embed_log = root / "embedded.txt"
        env = {**os.environ, "PYTHONPATH": str(model), "DATA_DIR": "data",
               "EMBED_LOG": str(embed_log)}
        env.pop("FAIL_EMBED", None)
        env.pop("SHORT_EMBED", None)
        journal = data / "journals" / "2026-10.md"
        events = data / "logs" / "events.jsonl"
        database = data / "memory" / "memory.db"

        def write_sources(journals, event_rows):
            journal.write_text("".join(
                f"### {timestamp} | {author} | {tag}\n\n{content}\n\n"
                for timestamp, author, tag, content in journals))
            events.write_text("".join(json.dumps(row) + "\n" for row in event_rows))

        def run(*args, extra_env=None, success=True):
            result = subprocess.run([sys.executable, str(SCRIPT), str(root), *args],
                                    env={**env, **(extra_env or {})},
                                    capture_output=True, text=True, timeout=30)
            assert (result.returncode == 0) == success, result.stdout + result.stderr
            return result.stdout

        def snapshot():
            with sqlite3.connect(database) as db:
                rows = db.execute(f"SELECT id, {FIELDS}, embedding FROM entries ORDER BY id").fetchall()
                state = dict(db.execute("SELECT key, value FROM index_state"))
            return rows, state

        # Every fixture vector is identical: semantic similarity must never erase text.
        base = (STAMP, "agent", "cycle", "Preserved invalid insight output.")
        distinct = (LATER, "agent", "cycle", "Preserved multiline operational learning output.")
        write_sources([base, distinct, base], [
            {"ts": STAMP, "type": "work", "summary": base[3]},
            {"ts": LATER, "type": "work", "summary": distinct[3]},
            {"ts": STAMP, "type": "work", "summary": base[3]},
        ])
        run()
        initial, state = snapshot()
        assert len(initial) == 4, "distinct records with identical embeddings disappeared"
        assert state == {"journal_last_ts": LATER, "event_last_ts": LATER,
                         "record_policy": "exact-source-record-v1"}
        assert len({row[-1] for row in initial}) == 1
        print("✓ distinct journal/event records survive identical embeddings")

        embedded = embed_log.read_bytes()
        for args in ((), ("--reindex",), ("--reindex",)):
            run(*args)
            assert snapshot() == (initial, state), "repeat/reindex changed stored records"
            assert embed_log.read_bytes() == embedded, "exact repeats were embedded again"
        print("✓ repeats and repeated full scans retain rows, IDs, embeddings and watermarks")

        # Change each field separately, including NULL event author and exact punctuation.
        variants = [
            (LATER, "agent", "cycle", base[3]),
            (STAMP, "other", "cycle", base[3]),
            (STAMP, "agent", "observation", base[3]),
            (STAMP, "agent", "cycle", base[3] + " 'Quoted'; full text."),
        ]
        write_sources([base, distinct, *variants, base], [
            {"ts": STAMP, "type": "work", "summary": base[3]},
            {"ts": STAMP, "type": "error", "summary": base[3]},
        ])
        run("--reindex")
        varied, varied_state = snapshot()
        assert len(varied) == 9, f"record metadata or complete text collapsed: {len(varied)}"
        assert varied[:4] == initial
        with sqlite3.connect(database) as db:
            hits = db.execute("SELECT content FROM entries_fts WHERE entries_fts MATCH 'Quoted'").fetchall()
        assert hits == [(variants[-1][3],)], "complete recovered text is absent from keyword retrieval"
        run("--reindex")
        assert snapshot() == (varied, varied_state)
        print("✓ source, timestamp, author, tag and complete text distinguish records; FTS retains text")

        # Model the old failure: progress advanced, but most raw records never entered SQLite.
        with sqlite3.connect(database) as db:
            db.execute("DELETE FROM entries WHERE id != ?", (initial[0][0],))
            db.execute("DELETE FROM index_state WHERE key = 'record_policy'")
        legacy, legacy_state = snapshot()
        assert len(legacy) == 1
        for failure in ("FAIL_EMBED", "SHORT_EMBED"):
            run(extra_env={failure: "1"}, success=False)
            assert snapshot() == (legacy, legacy_state), "failed recovery saved progress"
        print("✓ failed or incomplete embedding leaves recovery eligible and prior rows unchanged")

        run()
        recovered, recovered_state = snapshot()
        assert len(recovered) == 8, "automatic scan did not recover records behind both watermarks"
        assert recovered[0] == initial[0], "recovery replaced the existing row or vector"
        expected = {("journal", *row[:1], row[1], row[2], row[3])
                    for row in [base, distinct, *variants]}
        expected.update(("event", STAMP, None, tag, base[3]) for tag in ("work", "error"))
        assert {row[1:-1] for row in recovered} == expected
        assert recovered_state == varied_state
        for args in ((), ("--reindex",)):
            run(*args)
            assert snapshot() == (recovered, recovered_state)
        print("✓ existing databases recover omitted source text once without replacing saved history")

        # A later dated record still takes the incremental path after migration.
        newest = "2026-10-23T22:00:00-07:00"
        with events.open("a") as output:
            output.write(json.dumps({"ts": newest, "type": "work", "summary": distinct[3]}) + "\n")
        run()
        final, final_state = snapshot()
        assert len(final) == 9
        assert final[:-1] == recovered
        assert final[-1][1:-1] == ("event", newest, None, "work", distinct[3])
        assert final_state["journal_last_ts"] == LATER
        assert final_state["event_last_ts"] == newest
        run()
        assert snapshot() == (final, final_state)
        print("✓ later same-text events remain retrievable and advance only their own watermark")

        write_sources([base], [])
        run("--reindex")
        assert snapshot() == (final, final_state), "full scan regressed progress or erased older history"
        print("✓ a full scan preserves history and progress when raw sources have been shortened")

    print("\nAll source-record CLI regressions passed.")


if __name__ == "__main__":
    main()
