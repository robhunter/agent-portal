# Journaling

These are shared instructions for all agents using the agent-portal framework. Your agent-specific CLAUDE.md may add to these but should not duplicate them.

## Writing Journal Entries

**Always use the framework script** to write journal entries — never write timestamps yourself:

```bash
bash $FRAMEWORK_DIR/scripts/log-journal.sh $AGENT_DIR auto <author> <tag> "<content>"
```

- `auto` selects the correct monthly file (`journals/YYYY-MM.md`)
- The script generates the timestamp from the system clock
- Replace `<author>` with your agent name (e.g., `coder`, `pm`, `bobbo`, `contentbot`)
- Multi-line content works — the script handles it correctly

If you need to write to a project-specific journal instead of the monthly file, replace `auto` with the filename:

```bash
bash $FRAMEWORK_DIR/scripts/log-journal.sh $AGENT_DIR media-recs.md bobbo output "Delivered batch 3"
```

## Entry Format

The script produces entries in this format:

```
### 2026-04-22T22:34:04Z | contentbot | cycle

Entry content here. Can be multiple lines.
```

**Do not write this format manually.** Use the script.

## Tags

Valid tags and when to use them:

| Tag | When |
|---|---|
| `cycle` | End-of-cycle summary (what you did, what you found, decisions made) |
| `output` | Delivered a piece of work (link to the output file) |
| `feedback` | Processed user feedback (summarize what they said, what changed) |
| `observation` | Learned something relevant to future work |
| `direction` | Changed priorities or approach (explain why) |
| `note` | General note, thinking out loud, status update |
| `question` | Question for the user (they'll see it in the portal) |

## Rules

- **Append-only** — never edit or delete existing journal entries
- **Every cycle gets an entry** — a productive cycle without a journal entry is invisible to the user
- **Narrate decisions** — for important choices, explain your reasoning ("I chose X because Y")
- **Be concise** — the user reads these to understand what happened, not to re-read your thought process
- **On wake**, read the last ~10 entries for context before starting work
