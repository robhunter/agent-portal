#!/usr/bin/env python3
"""Exercise memory search and its CLI with real SQLite and offline embeddings.

Run with Python + numpy; no fastembed installation or model download is needed.
Only the embedding boundary is replaced. Indexing, FTS triggers, retrieval,
ranking, formatting, and command-line directory selection run unchanged.
"""

import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap


SCRIPTS = Path(__file__).resolve().parent


def load_module(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class QueryModel:
    def embed(self, texts):
        for _ in texts:
            yield [1.0, 0.0]


def add_entry(db, index, content, similarity, timestamp=""):
    vector = [similarity, math.sqrt(1 - similarity ** 2)]
    return db.execute(
        "INSERT INTO entries (source, timestamp, author, tag, content, embedding) "
        "VALUES ('journal', ?, 'agent', 'observation', ?, ?)",
        (timestamp, content, index.serialize_vec(vector)),
    ).lastrowid


def test_keyword_candidate_outside_vector_shortlist(index, search):
    with tempfile.TemporaryDirectory(prefix="memory-search-keyword-") as tmp:
        path = str(Path(tmp) / "memory.db")
        with index.init_db(path) as db:
            for n in range(25):
                add_entry(db, index, f"Unrelated deployment note {n}.", 0.2)
            target = add_entry(db, index, "The framework-update rollback repair.", 0)
        results = search.search(path, "framework-update rollback", QueryModel())
        assert len(results) == 5, results
        assert results[0]["id"] == target, "keyword-only candidate disappeared from the final ranking"
        assert results[0]["fts_score"] > 0, "real search did not use the sanitized keyword match"
        assert results[0]["vec_score"] == 0, "fixture target must be outside the vector shortlist"
    print("✓ keyword matching retrieves a candidate outside the top 20 vectors")


def test_vector_ranking_without_keywords(index, search):
    with tempfile.TemporaryDirectory(prefix="memory-search-vector-") as tmp:
        path = str(Path(tmp) / "memory.db")
        with index.init_db(path) as db:
            ids = [add_entry(db, index, f"Semantic result {n}.", similarity,
                             timestamp="invalid-date" if n % 2 else "")
                   for n, similarity in enumerate((0.1, 0.9, 0.3, 0.7, 0.5, 0.8))]
        results = search.search(path, "???", QueryModel())
        assert [r["id"] for r in results] == [ids[n] for n in (1, 5, 3, 4, 2)], results
        assert all(r["fts_score"] == r["rec_score"] == 0 for r in results), results
    print("✓ vector-only search ranks five results and tolerates undated entries")


def test_empty_database(index, search):
    with tempfile.TemporaryDirectory(prefix="memory-search-empty-") as tmp:
        path = str(Path(tmp) / "memory.db")
        index.init_db(path).close()
        results = search.search(path, "deployment", QueryModel())
        assert results == [], results
        assert search.format_results(results) == "No relevant memories found."
    print("✓ an empty initialized database returns the no-results message")


def test_index_and_search_cli():
    with tempfile.TemporaryDirectory(prefix="memory-search-cli-") as tmp:
        root = Path(tmp)
        models = root / "models"
        models.mkdir()
        (models / "fastembed.py").write_text(textwrap.dedent("""\
            class TextEmbedding:
                def __init__(self, **kwargs):
                    pass

                def embed(self, texts):
                    for text in texts:
                        yield [1.0, 0.0] if 'framework' in text else [0.0, 1.0]
            """))
        env = {**os.environ, "PYTHONPATH": str(models), "DATA_DIR": "data"}

        def run(script, *args, ok=True):
            result = subprocess.run([sys.executable, str(SCRIPTS / script), *args],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=30)
            assert (result.returncode == 0) == ok, result.stdout + result.stderr
            return result

        # Distinct contents make a wrong directory return valid but incorrect results.
        for directory, marker in ((".", "ROOT_RECORD"), ("data", "NESTED_RECORD"),
                                  ("override", "OVERRIDE_RECORD")):
            data = root / directory
            (data / "logs").mkdir(parents=True, exist_ok=True)
            (data / "logs" / "events.jsonl").write_text(json.dumps({
                "ts": "2026-10-22T18:00:00Z", "type": "work",
                "summary": f"framework-update rollback {marker}.",
            }) + "\n")
            run("memory-index.py", str(root), "--data-dir", directory)

        for args, expected in (((str(root),), "NESTED_RECORD"),
                               ((), "NESTED_RECORD"),
                               ((str(root), "--data-dir", "override"), "OVERRIDE_RECORD"),
                               ((str(root), "--data-dir", "."), "ROOT_RECORD")):
            output = run("memory-search.py", "framework-update rollback", *args).stdout
            assert "## Memory Search Results" in output, output
            assert "[event] 2026-10-22T18:00:00Z | work" in output, output
            assert expected in output, output
            for marker in {"ROOT_RECORD", "NESTED_RECORD", "OVERRIDE_RECORD"} - {expected}:
                assert marker not in output, output

        missing = run("memory-search.py", "framework-update rollback", str(root),
                      "--data-dir", "missing", ok=False)
        assert str(root / "missing" / "memory" / "memory.db") in missing.stderr, missing.stderr
        assert "Run memory-index.py first." in missing.stderr, missing.stderr
        assert "Loading embedding model" not in missing.stderr, missing.stderr
        assert not (root / "missing").exists(), "search must not create an empty database"
    print("✓ real indexing/search CLIs respect DATA_DIR, cwd, explicit overrides, and missing databases")


def main():
    index = load_module("memory-index")
    search = load_module("memory-search")
    test_keyword_candidate_outside_vector_shortlist(index, search)
    test_vector_ranking_without_keywords(index, search)
    test_empty_database(index, search)
    test_index_and_search_cli()
    print("\nAll memory search integration tests passed.")


if __name__ == "__main__":
    main()
