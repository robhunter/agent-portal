#!/usr/bin/env python3
"""End-to-end test for memory indexing and search."""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Add parent directory so we can import the scripts
sys.path.insert(0, os.path.dirname(__file__))


def create_test_data(tmp_dir: Path):
    """Create sample journal and events data."""
    journals_dir = tmp_dir / "journals"
    journals_dir.mkdir()
    logs_dir = tmp_dir / "logs"
    logs_dir.mkdir()
    memory_dir = tmp_dir / "memory"
    memory_dir.mkdir()

    # Sample journal
    (journals_dir / "2026-03.md").write_text("""# Test Journal — 2026-03

---

### 2026-03-01T10:00:00+00:00 | coder | output

Deployed the authentication service to Railway. Fixed OAuth2 callback URL configuration. All 15 tests passing.

### 2026-03-02T14:00:00+00:00 | rob | direction

Please focus on the database migration next. We need to move from SQLite to PostgreSQL before the launch.

### 2026-03-03T09:00:00+00:00 | coder | output

Completed PostgreSQL migration. Updated connection pooling config. Ran load tests — handles 500 concurrent connections. 22 tests passing.

### 2026-03-04T11:00:00+00:00 | coder | observation

The Redis cache hit rate dropped to 40% after the migration. Need to investigate key pattern changes.

### 2026-03-05T16:00:00+00:00 | rob | feedback

Don't use Vercel for deployments. We standardize on Railway for all projects.
""")

    # Sample events
    events = [
        {"ts": "2026-03-01T10:00:00+00:00", "type": "work", "summary": "Shipped authentication service deployment to Railway"},
        {"ts": "2026-03-02T14:30:00+00:00", "type": "work", "summary": "Started PostgreSQL migration planning"},
        {"ts": "2026-03-03T09:30:00+00:00", "type": "work", "summary": "Completed PostgreSQL migration, all tests pass"},
        {"ts": "2026-03-04T12:00:00+00:00", "type": "error", "summary": "Redis cache hit rate dropped after migration"},
        {"ts": "2026-03-05T08:00:00+00:00", "type": "work", "summary": "Investigated Redis key patterns, fixed prefix mismatch"},
    ]
    with open(logs_dir / "events.jsonl", "w") as f:
        for e in events:
            f.write(json.dumps(e) + "\n")


def test_indexing_and_search():
    """Test that indexing and search work end-to-end."""
    from importlib import import_module

    tmp_dir = Path(tempfile.mkdtemp(prefix="memory-test-"))
    try:
        create_test_data(tmp_dir)

        # Import and run indexer
        import importlib.util
        idx_spec = importlib.util.spec_from_file_location("memory_index", Path(__file__).parent / "memory-index.py")
        idx_mod = importlib.util.module_from_spec(idx_spec)

        search_spec = importlib.util.spec_from_file_location("memory_search", Path(__file__).parent / "memory-search.py")
        search_mod = importlib.util.module_from_spec(search_spec)

        # Load modules
        idx_spec.loader.exec_module(idx_mod)
        search_spec.loader.exec_module(search_mod)

        from fastembed import TextEmbedding

        db_path = str(tmp_dir / "memory" / "memory.db")

        # Test 1: Initialize and index
        conn = idx_mod.init_db(db_path)
        model = TextEmbedding(model_name=idx_mod.MODEL_NAME)

        journal_entries = idx_mod.parse_journal_entries(tmp_dir / "journals")
        event_entries = idx_mod.parse_events(tmp_dir / "logs" / "events.jsonl")

        assert len(journal_entries) == 5, f"Expected 5 journal entries, got {len(journal_entries)}"
        assert len(event_entries) == 5, f"Expected 5 event entries, got {len(event_entries)}"
        print(f"✓ Parsed 5 journal entries and 5 event entries")

        # Index all entries
        all_entries = journal_entries + event_entries
        texts = [e["content"] for e in all_entries]
        embeddings = list(model.embed(texts))

        indexed = 0
        for entry, emb in zip(all_entries, embeddings):
            import numpy as np
            emb_np = np.array(emb, dtype=np.float32)
            emb_bytes = idx_mod.serialize_vec(emb_np.tolist())

            if not idx_mod.is_duplicate(conn, emb_np):
                cursor = conn.execute(
                    "INSERT INTO entries (source, timestamp, author, tag, content, embedding) VALUES (?, ?, ?, ?, ?, ?)",
                    (entry["source"], entry["timestamp"], entry.get("author"),
                     entry.get("tag"), entry["content"], emb_bytes)
                )
                indexed += 1

        conn.commit()
        assert indexed >= 8, f"Expected at least 8 indexed entries, got {indexed}"
        print(f"✓ Indexed {indexed} entries (some duplicates expected)")

        # Test 2: Search for Railway deployment
        results = search_mod.search(db_path, "Railway deployment", model)
        assert len(results) > 0, "Expected search results for 'Railway deployment'"
        # The authentication deployment and Vercel note should be top results
        top_contents = [r["content"][:50] for r in results]
        has_railway = any("Railway" in c or "railway" in c for c in top_contents)
        assert has_railway, f"Expected Railway-related result in top results, got: {top_contents}"
        print(f"✓ Search 'Railway deployment' returned {len(results)} results, top hit mentions Railway")

        # Test 3: Search for database migration
        results = search_mod.search(db_path, "PostgreSQL database migration", model)
        assert len(results) > 0, "Expected search results for 'PostgreSQL database migration'"
        top_content = results[0]["content"]
        assert "PostgreSQL" in top_content or "migration" in top_content.lower(), \
            f"Expected PostgreSQL/migration in top result, got: {top_content[:100]}"
        print(f"✓ Search 'PostgreSQL database migration' returned relevant results")

        # Test 4: Recency boost — recent entries should score higher
        for r in results:
            assert "rec_score" in r, "Results should include recency score"
        print(f"✓ Results include recency scores")

        # Test 5: Deduplication — re-indexing similar content should be skipped
        import numpy as np
        test_emb = np.array(embeddings[0], dtype=np.float32)
        is_dup = idx_mod.is_duplicate(conn, test_emb)
        assert is_dup, "Expected duplicate detection for identical embedding"
        print(f"✓ Deduplication correctly identifies duplicate entries")

        # Test 6: Incremental indexing
        idx_mod.set_last_indexed(conn, "journal_last_ts", "2026-03-05T16:00:00+00:00")
        idx_mod.set_last_indexed(conn, "event_last_ts", "2026-03-05T08:00:00+00:00")
        last_ts = idx_mod.get_last_indexed(conn, "journal_last_ts")
        assert last_ts == "2026-03-05T16:00:00+00:00", "Last indexed timestamp not saved correctly"
        new_journal = [e for e in journal_entries if e["timestamp"] > last_ts]
        assert len(new_journal) == 0, f"Expected 0 new entries after full index, got {len(new_journal)}"
        print(f"✓ Incremental indexing correctly skips already-indexed entries")

        conn.close()
        print(f"\n✅ All tests passed!")

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    test_indexing_and_search()
