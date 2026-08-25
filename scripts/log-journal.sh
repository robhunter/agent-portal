#!/bin/bash
# scripts/log-journal.sh — Append a timestamped journal entry
# Usage: log-journal.sh <agent-dir> <journal-file> <author> <tag> <content>
#
# journal-file is relative to <agent-dir>/<DATA_DIR>/journals/
# (e.g., "bobbo.md" or "ai-research.md"). DATA_DIR resolves from
# portal.config.json's dataDir field (default ".").
set -e

AGENT_DIR="$1"
JOURNAL_FILE="$2"
if [ "$JOURNAL_FILE" = "auto" ]; then
  JOURNAL_FILE="$(date +%Y-%m).md"
fi
AUTHOR="$3"
TAG="$4"
CONTENT="$5"

if [ -z "$AGENT_DIR" ] || [ -z "$JOURNAL_FILE" ] || [ -z "$AUTHOR" ] || [ -z "$TAG" ] || [ -z "$CONTENT" ]; then
  echo "Usage: log-journal.sh <agent-dir> <journal-file> <author> <tag> <content>"
  exit 1
fi

# Resolve DATA_DIR from portal.config.json (defaults to ".")
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$DATA_DIR" ] && [ -f "$AGENT_DIR/portal.config.json" ]; then
  eval "$(bash "$FRAMEWORK_DIR/scripts/read-harness-config.sh" "$AGENT_DIR" 2>/dev/null | grep '^export DATA_DIR=')"
fi
DATA_DIR="${DATA_DIR:-.}"

JOURNAL_PATH="$AGENT_DIR/$DATA_DIR/journals/$JOURNAL_FILE"
mkdir -p "$(dirname "$JOURNAL_PATH")"

# --- Entry-body guard -------------------------------------------------------
#
# parseJournal() (lib/helpers.js) splits journal files on /^### /m and keeps a
# chunk only when its first line matches "<ts> | <author> | <tag>". There is no
# else branch, so an ordinary markdown "### " subheading inside an entry body
# ends that entry at read time and everything after it is discarded silently.
#
# The write itself always succeeds, which is why nothing ever surfaced: the
# bytes land on disk correctly and only the reader disagrees. So the writer is
# the right place to catch it — this is the only point where we still know what
# the author meant.
#
# We demote rather than reject. Losing a heading level is cosmetic; refusing the
# write risks an agent's whole cycle entry disappearing because a wrapper ran
# under `set -e` and never retried. Set JOURNAL_STRICT=1 to fail instead.
if printf '%s\n' "$CONTENT" | grep -q '^### '; then
  OFFENDERS="$(printf '%s\n' "$CONTENT" | grep -n '^### ' | head -5)"
  if [ "${JOURNAL_STRICT:-0}" = "1" ]; then
    {
      echo "Error: entry body contains '### ' at the start of a line."
      echo "The portal's journal parser treats those as entry headers and discards"
      echo "everything after them. Use '## ', '#### ', or a bold lead-in instead."
      echo "Offending lines:"
      echo "$OFFENDERS"
    } >&2
    exit 1
  fi
  {
    echo "log-journal.sh: WARNING — demoted $(printf '%s\n' "$CONTENT" | grep -c '^### ') '### ' heading(s) to '#### '."
    echo "  '### ' at line start is the journal entry delimiter; the portal's parser would"
    echo "  have silently dropped this entry's body from that point on. Content preserved."
    echo "  Use '## ', '#### ' or a bold lead-in to avoid this. JOURNAL_STRICT=1 to fail instead."
    echo "$OFFENDERS"
  } >&2
  CONTENT="$(printf '%s\n' "$CONTENT" | sed 's/^### /#### /')"
fi

{
  echo ""
  echo "### $(date -Iseconds) | $AUTHOR | $TAG"
  echo "$CONTENT"
} >> "$JOURNAL_PATH"

# Verify the entry we just wrote is readable by the parser that will render it.
# A writer that cannot prove its own output survives a round-trip is how 386
# sections went missing in the first place.
if command -v node >/dev/null 2>&1 && [ -f "$FRAMEWORK_DIR/lib/helpers.js" ]; then
  node -e '
    const { parseJournal } = require(process.argv[1]);
    const fs = require("fs");
    const entries = parseJournal(fs.readFileSync(process.argv[2], "utf-8"));
    const last = entries[entries.length - 1];
    if (!last) { console.error("log-journal.sh: WARNING — parser read back 0 entries."); process.exit(0); }
    const written = parseInt(process.argv[3], 10);
    // Allow a small delta for trailing-whitespace trimming by the parser.
    if (last.content.length < written - 8) {
      console.error("log-journal.sh: WARNING — round-trip check: wrote " + written +
        " chars, parser reads back " + last.content.length + ". Entry is being truncated.");
    }
  ' "$FRAMEWORK_DIR/lib/helpers.js" "$JOURNAL_PATH" "${#CONTENT}" >&2 || true
fi
