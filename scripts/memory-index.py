#!/usr/bin/env python3
"""Index journal entries and events into SQLite for semantic search.

Usage: memory-venv/bin/python scripts/memory-index.py /path/to/agent-dir [--data-dir DATA_DIR]

Parses journal markdown files and events.jsonl, generates embeddings via
fastembed (nomic-embed-text-v1.5), and stores in SQLite with FTS5 for
keyword search and numpy-based vector similarity. Incremental: only
indexes new entries since last run.

--data-dir defaults to "." (legacy layout — journals/, logs/, memory/ at
agent-dir root). Set to "data" for the dataDir layout where they live
under <agent-dir>/data/. The DATA_DIR environment variable is honored
when --data-dir is absent (matches what read-harness-config.sh exports).
"""

import json
import os
import re
import sqlite3
import struct
import sys
from pathlib import Path

# Prefer the OS CA bundle when present so HTTPS works inside TLS-intercepting
# environments (e.g. mitmproxy-style sandboxes). httpx — which fastembed uses
# to pull models from HuggingFace — defaults to certifi's bundle, which lacks
# any system-injected proxy CA.
if "SSL_CERT_FILE" not in os.environ and os.path.exists("/etc/ssl/certs/ca-certificates.crt"):
    os.environ["SSL_CERT_FILE"] = "/etc/ssl/certs/ca-certificates.crt"

import numpy as np
from fastembed import TextEmbedding

EMBED_DIM = 384
SIMILARITY_THRESHOLD = 0.92
MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBED_BATCH_SIZE = 50


def init_db(db_path: str) -> sqlite3.Connection:
    """Initialize SQLite database with FTS5 table."""
    conn = sqlite3.connect(db_path)

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            author TEXT,
            tag TEXT,
            content TEXT NOT NULL,
            embedding BLOB
        );
        CREATE TABLE IF NOT EXISTS index_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)

    # Create FTS5 virtual table
    try:
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
                content, content=entries, content_rowid=id
            );
        """)
    except sqlite3.OperationalError:
        pass

    # Create triggers for FTS sync
    for op, action in [
        ("INSERT", "INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content)"),
        ("DELETE", "INSERT INTO entries_fts(entries_fts, rowid, content) VALUES('delete', old.id, old.content)"),
        ("UPDATE", "INSERT INTO entries_fts(entries_fts, rowid, content) VALUES('delete', old.id, old.content); INSERT INTO entries_fts(rowid, content) VALUES (new.id, new.content)"),
    ]:
        try:
            conn.execute(f"""
                CREATE TRIGGER IF NOT EXISTS entries_fts_{op.lower()}
                AFTER {op} ON entries BEGIN
                    {action};
                END;
            """)
        except sqlite3.OperationalError:
            pass

    conn.commit()
    return conn


def parse_journal_entries(journal_dir: Path) -> list[dict]:
    """Parse journal markdown files into entries."""
    entries = []
    header_re = re.compile(r"^### (\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)", re.MULTILINE)

    for md_file in sorted(journal_dir.glob("*.md")):
        text = md_file.read_text(encoding="utf-8")
        parts = header_re.split(text)
        # parts: [preamble, ts1, author1, tag1, content1, ts2, ...]
        i = 1
        while i + 3 <= len(parts):
            ts, author, tag = parts[i], parts[i + 1], parts[i + 2]
            content = parts[i + 3].strip() if i + 3 < len(parts) else ""
            if content:
                entries.append({
                    "source": "journal",
                    "timestamp": ts,
                    "author": author,
                    "tag": tag,
                    "content": content,
                })
            i += 4

    return entries


def parse_events(events_path: Path) -> list[dict]:
    """Parse events.jsonl, filtering for substantive types."""
    entries = []
    include_types = {"work", "error", "dissonance", "respond"}

    if not events_path.exists():
        return entries

    for line in events_path.read_text(encoding="utf-8").strip().split("\n"):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") in include_types and event.get("summary"):
            entries.append({
                "source": "event",
                "timestamp": event.get("ts", ""),
                "author": None,
                "tag": event.get("type"),
                "content": event["summary"],
            })

    return entries


def serialize_vec(vec: list[float]) -> bytes:
    """Serialize float vector to bytes."""
    return struct.pack(f"{len(vec)}f", *vec)


def deserialize_vec(blob: bytes) -> np.ndarray:
    """Deserialize bytes to numpy array."""
    n = len(blob) // 4
    return np.array(struct.unpack(f"{n}f", blob), dtype=np.float32)


def is_duplicate(conn: sqlite3.Connection, embedding: np.ndarray) -> bool:
    """Check if an entry with cosine similarity > threshold already exists."""
    rows = conn.execute("SELECT embedding FROM entries WHERE embedding IS NOT NULL").fetchall()
    if not rows:
        return False

    for (blob,) in rows:
        existing = deserialize_vec(blob)
        sim = np.dot(embedding, existing) / (np.linalg.norm(embedding) * np.linalg.norm(existing) + 1e-10)
        if sim > SIMILARITY_THRESHOLD:
            return True
    return False


def get_last_indexed(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM index_state WHERE key = ?", (key,)).fetchone()
    return row[0] if row else ""


def set_last_indexed(conn: sqlite3.Connection, key: str, value: str):
    conn.execute("INSERT OR REPLACE INTO index_state (key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def main():
    if len(sys.argv) < 2:
        print("Usage: memory-index.py /path/to/agent-dir [--data-dir DATA_DIR]", file=sys.stderr)
        sys.exit(1)

    agent_dir = Path(sys.argv[1])

    # Resolve data-dir (CLI flag wins; else $DATA_DIR; else ".")
    data_dir = "."
    if "--data-dir" in sys.argv:
        idx = sys.argv.index("--data-dir")
        if idx + 1 < len(sys.argv):
            data_dir = sys.argv[idx + 1]
    else:
        data_dir = os.environ.get("DATA_DIR", ".")

    root = agent_dir / data_dir
    journal_dir = root / "journals"
    events_path = root / "logs" / "events.jsonl"
    memory_dir = root / "memory"
    memory_dir.mkdir(exist_ok=True)
    db_path = memory_dir / "memory.db"

    conn = init_db(str(db_path))

    print(f"Loading embedding model ({MODEL_NAME})...")
    model = TextEmbedding(model_name=MODEL_NAME)

    # Parse all entries
    journal_entries = parse_journal_entries(journal_dir) if journal_dir.exists() else []
    event_entries = parse_events(events_path)

    # Filter to only new entries (incremental)
    last_journal_ts = get_last_indexed(conn, "journal_last_ts")
    last_event_ts = get_last_indexed(conn, "event_last_ts")

    new_journal = [e for e in journal_entries if e["timestamp"] > last_journal_ts]
    new_events = [e for e in event_entries if e["timestamp"] > last_event_ts]

    all_new = new_journal + new_events
    if not all_new:
        print("No new entries to index.")
        conn.close()
        return

    print(f"Indexing {len(all_new)} new entries ({len(new_journal)} journal, {len(new_events)} events)...")

    # Embed in chunks so a long catch-up after an outage doesn't OOM the worker
    # — fastembed materializes the whole batch at peak, so 700+ entries can
    # exceed available memory inside small containers.
    texts = [e["content"] for e in all_new]
    embeddings = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        embeddings.extend(model.embed(texts[i:i + EMBED_BATCH_SIZE]))

    indexed = 0
    skipped = 0
    max_journal_ts = last_journal_ts
    max_event_ts = last_event_ts

    for entry, emb in zip(all_new, embeddings):
        emb_np = np.array(emb, dtype=np.float32)
        emb_bytes = serialize_vec(emb_np.tolist())

        # Deduplication check
        if is_duplicate(conn, emb_np):
            skipped += 1
        else:
            cursor = conn.execute(
                "INSERT INTO entries (source, timestamp, author, tag, content, embedding) VALUES (?, ?, ?, ?, ?, ?)",
                (entry["source"], entry["timestamp"], entry.get("author"),
                 entry.get("tag"), entry["content"], emb_bytes)
            )
            indexed += 1

        # Track max timestamps regardless
        if entry["source"] == "journal" and entry["timestamp"] > max_journal_ts:
            max_journal_ts = entry["timestamp"]
        elif entry["source"] == "event" and entry["timestamp"] > max_event_ts:
            max_event_ts = entry["timestamp"]

    conn.commit()

    if max_journal_ts > last_journal_ts:
        set_last_indexed(conn, "journal_last_ts", max_journal_ts)
    if max_event_ts > last_event_ts:
        set_last_indexed(conn, "event_last_ts", max_event_ts)

    print(f"Done. Indexed: {indexed}, Skipped (duplicates): {skipped}")
    conn.close()


if __name__ == "__main__":
    main()
