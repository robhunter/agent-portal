#!/usr/bin/env python3
"""Exercise malformed event records through the real incremental index CLI."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import textwrap


SCRIPT = Path(__file__).with_name("memory-index.py")
STAMP = "2026-10-24T09:00:00Z"
NEWER = "2026-10-24T09:00:01Z"


def main():
    with tempfile.TemporaryDirectory(prefix="memory-events-test-") as tmp:
        root = Path(tmp)
        data = root / "data"
        (data / "journals").mkdir(parents=True)
        (data / "logs").mkdir()
        models = root / "models"
        models.mkdir()
        (models / "fastembed.py").write_text(textwrap.dedent("""\
            import os

            class TextEmbedding:
                def __init__(self, **kwargs):
                    if os.environ.get("FORBID_MODEL"):
                        raise RuntimeError("saved records unexpectedly reached the model")

                def embed(self, texts):
                    for text in texts:
                        if os.environ.get("FAIL_EMBED"):
                            raise RuntimeError("fixture embedding failure")
                        text.encode("utf-8")
                        yield [1.0] * 384
            """))
        env = {**os.environ, "PYTHONPATH": str(models), "DATA_DIR": "data"}
        env.pop("FORBID_MODEL", None)
        env.pop("FAIL_EMBED", None)
        journal = data / "journals" / "2026-10.md"
        events = data / "logs" / "events.jsonl"
        database = data / "memory" / "memory.db"
        journal.write_text(f"### {STAMP} | agent | cycle\n\nInitial journal.\n")
        valid = [{"ts": STAMP, "type": kind,
                  "summary": f'{kind} event: "quoted", café.\nComplete second line.'}
                 for kind in ("work", "error", "dissonance", "respond")]

        def write_events(records):
            events.write_text("\n".join(json.dumps(record) for record in records) + "\n")

        def run(*args, extra_env=None, success=True):
            result = subprocess.run([sys.executable, str(SCRIPT), str(root), *args],
                                    env={**env, **(extra_env or {})},
                                    capture_output=True, text=True, timeout=30)
            assert (result.returncode == 0) == success, result.stdout + result.stderr
            return result.stdout + result.stderr

        def snapshot():
            with sqlite3.connect(database) as db:
                rows = db.execute("SELECT * FROM entries ORDER BY id").fetchall()
                state = dict(db.execute("SELECT key, value FROM index_state"))
                keywords = db.execute(
                    "SELECT rowid, content FROM entries_fts WHERE entries_fts MATCH 'Complete' "
                    "ORDER BY rowid").fetchall()
            return rows, state, keywords

        write_events(valid)
        run()
        initial = snapshot()
        assert len(initial[0]) == 5
        assert {row[3:6] for row in initial[0][1:]} == {
            (None, record["type"], record["summary"]) for record in valid}
        assert len(initial[2]) == 4

        malformed = [None, [], ["event"], "text", 17, 1.5, True, False, {},
                     {"type": "cycle_start", "summary": "Excluded event."},
                     {"type": "unknown", "summary": "Excluded event."}]
        malformed.extend({"ts": "2099-01-01T00:00:00Z", "type": kind,
                          "summary": "Invalid type."}
                         for kind in (None, [], ["work"], {}, {"name": "work"}, 1, True))
        malformed.extend({"ts": "2099-01-01T00:00:00Z", "type": "work",
                          "summary": summary}
                         for summary in (None, "", [], ["text"], {}, {"text": "value"}, 1, True))
        malformed.extend([{"type": "work"}, {"summary": "Missing event type."}])
        failures = []
        for record in malformed:
            write_events([record, valid[0], record, *valid[1:], record])
            try:
                run("--reindex", extra_env={"FORBID_MODEL": "1"})
                assert snapshot() == initial, "malformed input changed saved rows, FTS or progress"
            except AssertionError as error:
                failures.append(f"{record!r}: {error}")
        assert not failures, "\n".join(failures)
        print(f"✓ {len(malformed)} malformed/excluded shapes preserve valid records, FTS and watermarks")

        write_events([*malformed, *valid, *malformed])
        with events.open("a") as output:
            output.write('\n{broken JSON\n{"type":\n')
            output.write(json.dumps({"ts": NEWER, "type": "respond",
                                     "summary": "Complete appended event."}) + "\n")
        with journal.open("a") as output:
            output.write(f"\n### {NEWER} | agent | observation\n\nAppended journal.\n")
        failure = run(extra_env={"FAIL_EMBED": "1"}, success=False)
        assert "fixture embedding failure" in failure, failure
        assert snapshot() == initial, "failed indexing changed history or retry progress"
        run()
        final = snapshot()
        assert final[0][:5] == initial[0]
        assert {row[1:6] for row in final[0][5:]} == {
            ("journal", NEWER, "agent", "observation", "Appended journal."),
            ("event", NEWER, None, "respond", "Complete appended event.")}
        assert final[1]["journal_last_ts"] == final[1]["event_last_ts"] == NEWER
        assert final[2][:-1] == initial[2]
        assert final[2][-1][1] == "Complete appended event."
        print("✓ valid later records survive mixed bad lines and a failed embedding retry")

        for args in ((), ("--reindex",)):
            output = run(*args, extra_env={"FORBID_MODEL": "1"})
            assert "Indexed: 0" in output, output
            assert snapshot() == final
        print("✓ repeat and full scans preserve saved IDs/vectors and never reload the model")

    print("\nAll event-shape CLI regressions passed.")


if __name__ == "__main__":
    main()
