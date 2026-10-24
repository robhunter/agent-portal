#!/usr/bin/env python3
"""Exercise multi-batch catch-up and retry through the real memory index CLI."""

import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import subprocess
import sys
import tempfile
import textwrap


SCRIPT = Path(__file__).with_name("memory-index.py")
STAMP = "2026-10-24T15:00:00Z"
LATER = "2026-10-24T15:00:01Z"


def expected_vector(content):
    return struct.pack("384f", *(list(hashlib.sha256(content.encode()).digest()) * 12))


def main():
    with tempfile.TemporaryDirectory(prefix="memory-batches-") as tmp:
        root = Path(tmp)
        data = root / "data"
        (data / "journals").mkdir(parents=True)
        (data / "logs").mkdir()
        models = root / "models"
        models.mkdir()
        (models / "fastembed.py").write_text(textwrap.dedent("""\
            import hashlib
            import json
            import os
            from pathlib import Path

            class TextEmbedding:
                def __init__(self, **kwargs):
                    if os.environ.get("FORBID_MODEL"):
                        raise RuntimeError("saved records unexpectedly reached the model")
                    self.calls = 0

                def embed(self, texts):
                    self.calls += 1
                    with Path(os.environ["BATCH_LOG"]).open("a") as output:
                        output.write(json.dumps(texts) + "\\n")
                    if len(texts) > 50:
                        raise RuntimeError("embedding request exceeded the batch limit")
                    for position, text in enumerate(texts):
                        if self.calls == 2 and position == len(texts) - 1:
                            if os.environ.get("FAIL_SECOND_BATCH"):
                                raise RuntimeError("fixture late-batch failure")
                            if os.environ.get("SHORT_SECOND_BATCH"):
                                return
                        yield list(hashlib.sha256(text.encode()).digest()) * 12
            """))
        log = root / "batches.jsonl"
        env = {**os.environ, "PYTHONPATH": str(models), "DATA_DIR": "data",
               "BATCH_LOG": str(log)}
        for name in ("FORBID_MODEL", "FAIL_SECOND_BATCH", "SHORT_SECOND_BATCH"):
            env.pop(name, None)
        journal = data / "journals" / "2026-10.md"
        events = data / "logs" / "events.jsonl"
        database = data / "memory" / "memory.db"
        seed = "Previously indexed café record."
        journal.write_text(f"### {STAMP} | agent | cycle\n\n{seed}\n")

        def run(*args, extra_env=None, success=True):
            log.write_text("")
            result = subprocess.run([sys.executable, str(SCRIPT), str(root), *args],
                                    env={**env, **(extra_env or {})},
                                    capture_output=True, text=True, timeout=30)
            assert (result.returncode == 0) == success, result.stdout + result.stderr
            batches = [json.loads(line) for line in log.read_text().splitlines()]
            return result.stdout + result.stderr, batches

        def snapshot():
            with sqlite3.connect(database) as db:
                rows = db.execute("SELECT * FROM entries ORDER BY id").fetchall()
                state = dict(db.execute("SELECT key, value FROM index_state"))
                fts = db.execute(
                    "SELECT rowid, content FROM entries_fts WHERE entries_fts MATCH 'café' "
                    "ORDER BY rowid").fetchall()
            return rows, state, fts

        run()
        initial = snapshot()
        journals = [f"Journal café record {n}: complete quoted 'text'." for n in range(61)]
        summaries = [f"Event café record {n}: complete second line.\nMore text." for n in range(64)]
        with journal.open("a") as output:
            for content in journals:
                output.write(f"\n### {LATER} | agent | observation\n\n{content}\n")
        events.write_text("".join(json.dumps({"ts": LATER, "type": "work", "summary": content})
                                  + "\n" for content in summaries))
        raw = (journal.read_bytes(), events.read_bytes())
        expected = journals + summaries

        for recovery in (False, True):
            if recovery:
                with sqlite3.connect(database) as db:
                    db.execute("DELETE FROM index_state WHERE key = 'record_policy'")
            before = snapshot()
            for failure, message in (("FAIL_SECOND_BATCH", "fixture late-batch failure"),
                                     ("SHORT_SECOND_BATCH", "Embedding count does not match")):
                output, batches = run(extra_env={failure: "1"}, success=False)
                assert message in output, output
                assert batches[0] == expected[:50]
                assert batches[1] == expected[50:100]
                assert snapshot() == before, "a later-batch failure changed history, FTS or progress"
                assert (journal.read_bytes(), events.read_bytes()) == raw
            print(f"✓ later-batch failure and short output preserve {'recovery' if recovery else 'incremental'} retry state")

        output, batches = run()
        assert "Indexed: 125" in output, output
        assert [len(batch) for batch in batches] == [50, 50, 25], batches
        assert [text for batch in batches for text in batch] == expected
        final = snapshot()
        assert final[0][0] == initial[0][0], "catch-up replaced saved history"
        assert [(row[1], row[2], row[3], row[4], row[5]) for row in final[0][1:]] == (
            [("journal", LATER, "agent", "observation", text) for text in journals]
            + [("event", LATER, None, "work", text) for text in summaries])
        assert all(row[6] == expected_vector(row[5]) for row in final[0])
        assert final[1] == {"journal_last_ts": LATER, "event_last_ts": LATER,
                            "record_policy": "exact-source-record-v1"}
        assert final[2] == [(row[0], row[5]) for row in final[0]]
        print("✓ 125 pending records cross source and batch boundaries with exact text/vector associations")

        for args in ((), ("--reindex",)):
            output, batches = run(*args, extra_env={"FORBID_MODEL": "1"})
            assert "Indexed: 0" in output and not batches, output
            assert snapshot() == final
        assert (journal.read_bytes(), events.read_bytes()) == raw
        print("✓ repeated incremental and full scans retain all IDs/vectors without loading the model")

    print("\nAll multi-batch CLI regressions passed.")


if __name__ == "__main__":
    main()
