#!/usr/bin/env python3
"""Retain appended records at an incremental watermark through the real CLI."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import textwrap


SCRIPT = Path(__file__).with_name("memory-index.py")
STAMP = "2026-10-24T00:00:00-07:00"
EQUIVALENT = "2026-10-24T07:00:00Z"
NEWER = "2026-10-24T00:00:01-07:00"


def main():
    with tempfile.TemporaryDirectory(prefix="memory-boundary-test-") as tmp:
        root = Path(tmp)
        data = root / "data"
        (data / "journals").mkdir(parents=True)
        (data / "logs").mkdir()
        model = root / "model"
        model.mkdir()
        embedded = root / "embedded.jsonl"
        (model / "fastembed.py").write_text(textwrap.dedent("""\
            import json
            import os
            from pathlib import Path
            import numpy as np

            class TextEmbedding:
                def __init__(self, **kwargs):
                    if os.environ.get("FORBID_MODEL"):
                        raise RuntimeError("repeat unexpectedly loaded the model")

                def embed(self, texts):
                    for text in texts:
                        if os.environ.get("FAIL_EMBED"):
                            raise RuntimeError("fixture embedding failure")
                        with Path(os.environ["EMBED_LOG"]).open("a") as output:
                            output.write(json.dumps(text) + "\\n")
                        yield np.ones(384)
            """))
        env = {**os.environ, "PYTHONPATH": str(model), "DATA_DIR": "data",
               "EMBED_LOG": str(embedded)}
        env.pop("FAIL_EMBED", None)
        env.pop("FORBID_MODEL", None)
        journal = data / "journals" / "2026-10.md"
        events = data / "logs" / "events.jsonl"

        def append(timestamp, label):
            with journal.open("a") as output:
                output.write(f"### {timestamp} | agent | cycle\n\nJournal {label}.\n\n")
            with events.open("a") as output:
                output.write(json.dumps({"ts": timestamp, "type": "work",
                                         "summary": f"Event {label}."}) + "\n")

        def run(*args, extra_env=None, success=True):
            result = subprocess.run([sys.executable, str(SCRIPT), str(root), *args],
                                    env={**env, **(extra_env or {})},
                                    capture_output=True, text=True, timeout=30)
            assert (result.returncode == 0) == success, result.stdout + result.stderr
            return result.stdout

        def snapshot():
            with sqlite3.connect(data / "memory" / "memory.db") as db:
                rows = db.execute("SELECT * FROM entries ORDER BY id").fetchall()
                state = dict(db.execute("SELECT key, value FROM index_state"))
            return rows, state

        def assert_new(previous, expected, watermark):
            rows, state = snapshot()
            assert rows[:len(previous)] == previous, "saved IDs, metadata or vectors changed"
            assert {row[5] for row in rows[len(previous):]} == expected, [row[:6] for row in rows]
            assert state["journal_last_ts"] == state["event_last_ts"] == watermark, state
            with sqlite3.connect(data / "memory" / "memory.db") as db:
                for content in expected:
                    hits = db.execute("SELECT content FROM entries_fts WHERE entries_fts MATCH ?",
                                      ('"' + content + '"',)).fetchall()
                    assert (content,) in hits, "retained text is absent from keyword retrieval"
            return rows

        def assert_repeat():
            before = snapshot()
            model_calls = embedded.read_bytes()
            for args in ((), ("--reindex",)):
                run(*args, extra_env={"FORBID_MODEL": "1"})
                assert snapshot() == before
                assert embedded.read_bytes() == model_calls

        append(STAMP, "initial")
        run()
        initial, initial_state = snapshot()
        assert len(initial) == 2

        append(STAMP, "same second")
        run()
        same_second = assert_new(initial, {"Journal same second.", "Event same second."}, STAMP)
        assert snapshot()[1] == initial_state
        assert_repeat()
        print("✓ appended same-second journals/events are indexed once without moving watermarks")

        append(EQUIVALENT, "equivalent instant")
        run()
        equivalent = assert_new(same_second,
                                {"Journal equivalent instant.", "Event equivalent instant."}, STAMP)
        assert_repeat()
        print("✓ equivalent UTC offsets retain new text and preserve the original watermark")

        append(STAMP, "boundary beside newer")
        append(NEWER, "newer")
        run(extra_env={"FAIL_EMBED": "1"}, success=False)
        assert snapshot()[0] == equivalent
        assert snapshot()[1] == initial_state
        run()
        final = assert_new(equivalent, {"Journal boundary beside newer.",
                                       "Event boundary beside newer.",
                                       "Journal newer.", "Event newer."}, NEWER)
        assert len(final) == 10
        assert_repeat()
        print("✓ boundary and newer records survive a failed model call and advance progress together")

    print("\nAll incremental-boundary CLI regressions passed.")


if __name__ == "__main__":
    main()
