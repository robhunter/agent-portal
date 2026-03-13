#!/usr/bin/env python3
"""Search agent memory using hybrid vector + keyword matching.

Usage: memory-venv/bin/python scripts/memory-search.py "query text" [/path/to/agent-dir]

Combines numpy-based cosine similarity with FTS5 keyword matching and
recency boost. Returns top-5 results with date, author, tag, content
snippet, and relevance score.
"""

import math
import sqlite3
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

EMBED_DIM = 384
MODEL_NAME = "BAAI/bge-small-en-v1.5"
TOP_K = 5
VEC_WEIGHT = 0.6
FTS_WEIGHT = 0.25
RECENCY_WEIGHT = 0.15


def serialize_vec(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def deserialize_vec(blob: bytes) -> np.ndarray:
    n = len(blob) // 4
    return np.array(struct.unpack(f"{n}f", blob), dtype=np.float32)


def recency_score(timestamp_str: str) -> float:
    """Logarithmic decay: 1.0 for today, ~0.7 at 7 days, ~0.5 at 30 days."""
    try:
        ts = timestamp_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts)
        now = datetime.now(timezone.utc)
        days_ago = max((now - dt).total_seconds() / 86400, 0.01)
        return 1.0 / (1.0 + math.log(1 + days_ago / 7))
    except Exception:
        return 0.0


def search(db_path: str, query: str, model: TextEmbedding) -> list[dict]:
    """Perform hybrid search combining vector, keyword, and recency."""
    conn = sqlite3.connect(db_path)

    # Generate query embedding
    query_emb = np.array(list(model.embed([query]))[0], dtype=np.float32)

    # Vector search: compute cosine similarity against all entries
    vec_results = {}
    rows = conn.execute("SELECT id, embedding FROM entries WHERE embedding IS NOT NULL").fetchall()
    for row_id, blob in rows:
        emb = deserialize_vec(blob)
        sim = float(np.dot(query_emb, emb) / (np.linalg.norm(query_emb) * np.linalg.norm(emb) + 1e-10))
        vec_results[row_id] = max(0, sim)

    # Keep top 20 by vector score
    if len(vec_results) > 20:
        sorted_vec = sorted(vec_results.items(), key=lambda x: x[1], reverse=True)[:20]
        vec_results = dict(sorted_vec)

    # FTS keyword search
    fts_results = {}
    try:
        fts_rows = conn.execute(
            "SELECT rowid, rank FROM entries_fts WHERE entries_fts MATCH ? ORDER BY rank LIMIT 20",
            (query,)
        ).fetchall()
        if fts_rows:
            max_rank = max(abs(r[1]) for r in fts_rows)
            for row_id, rank in fts_rows:
                fts_results[row_id] = abs(rank) / max_rank if max_rank > 0 else 0
    except Exception:
        pass

    # Combine candidates
    all_ids = set(vec_results.keys()) | set(fts_results.keys())
    if not all_ids:
        conn.close()
        return []

    scored = []
    for entry_id in all_ids:
        row = conn.execute(
            "SELECT id, source, timestamp, author, tag, content FROM entries WHERE id = ?",
            (entry_id,)
        ).fetchone()
        if not row:
            continue

        _, source, timestamp, author, tag, content = row
        vec_score = vec_results.get(entry_id, 0)
        fts_score = fts_results.get(entry_id, 0)
        rec_score = recency_score(timestamp)

        combined = (VEC_WEIGHT * vec_score +
                    FTS_WEIGHT * fts_score +
                    RECENCY_WEIGHT * rec_score)

        scored.append({
            "id": entry_id,
            "source": source,
            "timestamp": timestamp,
            "author": author,
            "tag": tag,
            "content": content,
            "score": combined,
            "vec_score": vec_score,
            "fts_score": fts_score,
            "rec_score": rec_score,
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    conn.close()
    return scored[:TOP_K]


def format_results(results: list[dict]) -> str:
    """Format search results as human-readable markdown."""
    if not results:
        return "No relevant memories found."

    lines = ["## Memory Search Results\n"]
    for i, r in enumerate(results, 1):
        snippet = r["content"][:300]
        if len(r["content"]) > 300:
            snippet += "..."

        author_str = f" | {r['author']}" if r["author"] else ""
        tag_str = f" | {r['tag']}" if r["tag"] else ""
        score_str = f"{r['score']:.3f}"

        lines.append(f"### {i}. [{r['source']}] {r['timestamp']}{author_str}{tag_str} (score: {score_str})")
        lines.append(f"\n{snippet}\n")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print('Usage: memory-search.py "query text" [/path/to/agent-dir]', file=sys.stderr)
        sys.exit(1)

    query = sys.argv[1]
    agent_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.cwd()
    db_path = agent_dir / "memory" / "memory.db"

    if not db_path.exists():
        print(f"Memory database not found at {db_path}. Run memory-index.py first.", file=sys.stderr)
        sys.exit(1)

    print(f"Loading embedding model ({MODEL_NAME})...", file=sys.stderr)
    model = TextEmbedding(model_name=MODEL_NAME)

    results = search(str(db_path), query, model)
    print(format_results(results))


if __name__ == "__main__":
    main()
