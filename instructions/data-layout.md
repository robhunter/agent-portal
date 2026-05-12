# Data Layout

Every agent has a *code* surface (operator-edited, version-controlled) and a *data* surface (the agent's mutable state). The framework can keep these separated under one root directory via the optional `dataDir` field in `portal.config.json`.

## The two modes

### Legacy (default — `dataDir: "."` or omitted)

All paths resolve under the agent root. This is the original layout — every existing agent works this way and nothing forces a migration.

```
<agentDir>/
├── CLAUDE.md           # operator-owned
├── agent.yaml
├── portal.config.json
├── scripts/, skills/
├── logs/               # data: events.jsonl, cycles/, health.jsonl, ...
├── journals/           # data: YYYY-MM.md
├── memory/             # data: preferences.yaml, rated-items.yaml, ...
├── content/items/      # data
├── config/             # data: sources.yaml, categories.yaml, credentials/
├── input/feedback/     # data
├── output/             # data
├── uploads/            # data
└── requests/           # data
```

### dataDir layout (`dataDir: "data"`)

All framework-managed mutable state moves under `<agentDir>/<dataDir>/`. Operator-owned files stay at the agent root. This is the layout for hosted deployments (per-user data on a mounted volume) and self-hosted users who want a clean `.gitignore` boundary.

```
<agentDir>/                 # code repo (pushed)
├── CLAUDE.md
├── agent.yaml
├── portal.config.json     # has "dataDir": "data"
├── scripts/, skills/
└── data/                  # gitignored, mounted volume, etc.
    ├── logs/
    ├── journals/
    ├── memory/
    ├── content/items/
    ├── config/
    ├── input/feedback/
    ├── output/
    ├── uploads/
    └── requests/
```

## What lives where

| Path | Under `dataDir` | Reason |
|------|------------------|--------|
| `logs/`, `journals/`, `memory/`, `output/`, `uploads/`, `input/`, `requests/` | yes | written every cycle |
| `content/items/` (or whatever `features.library.dataDir` is set to) | yes | agent-curated state |
| `config/sources.yaml`, `config/categories.yaml`, `config/credentials/` | yes | user-mutable via the portal |
| `human_todos.md` | yes | portal writes via `/api/todos` |
| `pending_notification.txt` | yes | written by the agent each cycle |
| `today.md`, `roadmap.md` | no — stays at root | read-only operator docs |
| `CLAUDE.md`, `agent.yaml`, `portal.config.json` | no | operator/code |
| `scripts/`, `skills/`, `tools/`, `.mcp.json` | no | operator/code |
| `.env`, `.gitignore` | no | operator/code |

## Migrating an existing agent

1. Set `"dataDir": "data"` in `portal.config.json`.
2. `git mv` each data directory into `data/`:
   ```bash
   mkdir -p data
   for d in logs journals memory content config input output uploads requests; do
     [ -d "$d" ] && git mv "$d" "data/$d"
   done
   ```
3. `git rm --cached -r data/` so future writes under `data/` aren't tracked, then add `data/` to `.gitignore`.
4. Update `CLAUDE.md` path references — `memory/...` → `data/memory/...`, etc. The framework resolves paths via `dataDir`, but the agent itself reads paths from its own prompt.
5. Update `agent.yaml`'s `wake-prompt` and `respond-prompt` path references.
6. Run a smoke cycle (`bash scripts/respond.sh .`) to confirm writes land at the right place.

For a local rollback safety net, run `git init` inside `data/` as a separate, non-pushed repo.

## How resolution works

The framework reads `dataDir` from `portal.config.json` (defaulting to `"."`) and exposes it two ways:

- **Node routes** call `dataPath(config, ...parts)` from `lib/helpers.js`, which returns `path.join(config.agentDir, config.dataDir || '.', ...parts)`.
- **Shell scripts** source `read-harness-config.sh`, which exports `DATA_DIR`. Each script prefixes its hardcoded paths with `$DATA_DIR/`.
- **Python scripts** (`memory-index.py`, `memory-search.py`) accept a `--data-dir` flag and fall back to the `DATA_DIR` env var.

`features.library.dataDir` (currently `"content/items"`) is resolved *under* the top-level `dataDir`. With `dataDir: "data"` the library auto-resolves to `data/content/items` without you touching that field.

## Why not symlinks?

Symlinks would have let the framework continue using bare paths like `logs/` while the actual storage lived in `data/logs/`. They were rejected because:

- Hosted deployments need a clean filesystem boundary — symlinks complicate per-user volume mounting.
- A stray `rm -rf data/` against a symlink target is silently catastrophic.
- The explicit field is easier to reason about across language boundaries (Node + shell + Python).

## What this does not change

- `commit.sh` still runs `git add -A` — gitignoring `data/` is what keeps cycle writes out of the code repo.
- Agent prompts (`CLAUDE.md`, `agent.yaml`) are not auto-rewritten; the framework doesn't read them. You update those when you migrate.
- Other agents that don't set `dataDir` keep working with no changes.

## Content publishing gate (`publish-content.sh`)

For agents that have a `features.library` and a `<dataDir>/config/sources.yaml`, the framework provides a validation gate to prevent the agent from publishing recommendations that link to unapproved or fabricated URLs:

```bash
bash ../agent-portal/scripts/publish-content.sh <agent-dir> <yaml-path> [--dry-run] [--skip-fetch]
```

Pass scenarios → moves the draft into `<dataDir>/content/items/<id>.yaml`.
Fail scenarios → moves the draft into `<dataDir>/content/rejected/<id>.yaml` with a `_validation:` block listing every error.

### Two validation layers

1. **Host allowlist.** Every URL in `source_url` and `sources[].url` must trace to an approved source's host. Sources declare hosts via a `hosts:` field in `sources.yaml`; the validator falls back to the hostname parsed from `url:` for backwards compat. Pending sources (`status: pending`) are rejected — only `status: approved` qualifies.
2. **Live fetch.** HEAD (GET fallback on 405) with a 10s timeout per URL, 2 retries on connection errors. 2xx/3xx = pass; anything else = fail. Cover URLs are *not* validated — they often come from third-party CDNs and aren't the safety concern. Only navigational URLs are checked.

### Agent integration

The agent's `CLAUDE.md` should instruct: write content YAML to a scratch path (e.g. `/tmp/item-<id>.yaml`), then call `publish-content.sh`. Never `Write` into `<dataDir>/content/items/` directly — the gate cannot enforce against bypasses.

When `publish-content.sh` exits non-zero, the agent should read the `_validation` block in the quarantined file, fix the offending URLs (or skip the item entirely), and retry. The `--dry-run` flag lets the agent self-check without touching the filesystem.

### Backwards compat

Agents that don't have `features.library` configured can ignore the gate. The script reads `<dataDir>/config/sources.yaml`; if that file is absent, validation fails with exit code 2 and a clear error pointing at the missing registry.
