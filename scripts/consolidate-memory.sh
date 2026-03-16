#!/bin/bash
# scripts/consolidate-memory.sh — Automated memory consolidation (Phase 3)
# Usage: consolidate-memory.sh <agent-dir> [--force]
#
# Reads recent journal entries and events since last consolidation, uses
# claude --print to distill operational patterns and key learnings, then
# updates memory/consolidated-insights.yaml and memory/operational.yaml.
#
# Triggered from wake.sh when cycle count threshold is met.
# Configurable via memory/config.yaml (default: every 100 cycles).
#
# Design constraints:
#   - Script-based, not agent-cycle (uses claude --print)
#   - Cycle-based trigger, not calendar
#   - Additive, not destructive (never deletes journal entries)
#   - Idempotent (running twice with no new data produces no changes)
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:?Usage: consolidate-memory.sh <agent-dir> [--force]}"
FORCE="${2:-}"

# ── PATHS ──

CONFIG_FILE="$AGENT_DIR/memory/config.yaml"
INSIGHTS_FILE="$AGENT_DIR/memory/consolidated-insights.yaml"
OPERATIONAL_FILE="$AGENT_DIR/memory/operational.yaml"
EVENTS_FILE="$AGENT_DIR/logs/events.jsonl"
JOURNALS_DIR="$AGENT_DIR/journals"

# ── CONFIG ──

# Default cycle threshold
CYCLE_THRESHOLD=100

# Read config if it exists (simple YAML parsing for cycle_threshold)
if [ -f "$CONFIG_FILE" ]; then
  val=$(grep -E '^\s*cycle_threshold:' "$CONFIG_FILE" 2>/dev/null | head -1 | sed 's/.*: *//' | tr -d ' ')
  [ -n "$val" ] && CYCLE_THRESHOLD="$val"
fi

# ── CYCLE COUNT CHECK ──

# Count cycle_start events since last consolidation
LAST_CONSOLIDATION_TS=""
if [ -f "$INSIGHTS_FILE" ]; then
  LAST_CONSOLIDATION_TS=$(grep -E '^\s*last_consolidated:' "$INSIGHTS_FILE" 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | tr -d '"' | tr -d "'" | tr -d ' ')
fi

# Count cycles since last consolidation
if [ -n "$LAST_CONSOLIDATION_TS" ]; then
  CYCLES_SINCE=$(grep -c '"type":"cycle_start"' "$EVENTS_FILE" 2>/dev/null || echo 0)
  CYCLES_BEFORE=$(grep '"type":"cycle_start"' "$EVENTS_FILE" 2>/dev/null | awk -F'"ts":"' '{print $2}' | awk -F'"' '{print $1}' | awk -v ts="$LAST_CONSOLIDATION_TS" '$1 <= ts' | wc -l)
  CYCLES_SINCE=$((CYCLES_SINCE - CYCLES_BEFORE))
else
  CYCLES_SINCE=$(grep -c '"type":"cycle_start"' "$EVENTS_FILE" 2>/dev/null || echo 0)
fi

if [ "$FORCE" != "--force" ] && [ "$CYCLES_SINCE" -lt "$CYCLE_THRESHOLD" ]; then
  echo "Consolidation not needed: $CYCLES_SINCE cycles since last consolidation (threshold: $CYCLE_THRESHOLD)"
  exit 0
fi

echo "Running memory consolidation: $CYCLES_SINCE cycles since last consolidation (threshold: $CYCLE_THRESHOLD)"

# ── GATHER INPUT DATA ──

# Collect journal entries since last consolidation
JOURNAL_CONTENT=""
for md_file in "$JOURNALS_DIR"/*.md; do
  [ -f "$md_file" ] || continue
  if [ -n "$LAST_CONSOLIDATION_TS" ]; then
    # Extract entries newer than last consolidation timestamp
    JOURNAL_CONTENT="$JOURNAL_CONTENT
$(awk -v ts="$LAST_CONSOLIDATION_TS" '
  /^### [0-9]/ {
    split($2, a, " ")
    entry_ts = a[1]
    if (entry_ts > ts) { printing=1 } else { printing=0 }
  }
  printing { print }
' "$md_file")"
  else
    JOURNAL_CONTENT="$JOURNAL_CONTENT
$(cat "$md_file")"
  fi
done

# Collect work events since last consolidation
EVENTS_CONTENT=""
if [ -n "$LAST_CONSOLIDATION_TS" ]; then
  EVENTS_CONTENT=$(grep -E '"type":"(work|error|dissonance)"' "$EVENTS_FILE" 2>/dev/null | \
    awk -F'"ts":"' '{split($2,a,"\""); if(a[1] > "'"$LAST_CONSOLIDATION_TS"'") print}' || true)
else
  EVENTS_CONTENT=$(grep -E '"type":"(work|error|dissonance)"' "$EVENTS_FILE" 2>/dev/null || true)
fi

# Check if there's new data to consolidate
if [ -z "$(echo "$JOURNAL_CONTENT" | tr -d '[:space:]')" ] && [ -z "$EVENTS_CONTENT" ]; then
  echo "No new data since last consolidation. Skipping."
  exit 0
fi

# Truncate input to avoid overwhelming the LLM (keep last ~200 lines of journal,
# last ~100 events). The consolidation focuses on patterns, not exhaustive coverage.
JOURNAL_CONTENT=$(echo "$JOURNAL_CONTENT" | tail -200)
EVENTS_CONTENT=$(echo "$EVENTS_CONTENT" | tail -100)

# Read existing files for context
EXISTING_OPERATIONAL=""
[ -f "$OPERATIONAL_FILE" ] && EXISTING_OPERATIONAL=$(cat "$OPERATIONAL_FILE")

EXISTING_INSIGHTS=""
[ -f "$INSIGHTS_FILE" ] && EXISTING_INSIGHTS=$(cat "$INSIGHTS_FILE")

# ── CONSOLIDATION VIA CLAUDE ──

# Write prompt to temp file using heredoc to avoid shell escaping issues
PROMPT_FILE=$(mktemp)
CONSOLIDATION_TS=$(date -Iseconds)
trap "rm -f $PROMPT_FILE" EXIT

cat > "$PROMPT_FILE" <<PROMPT_EOF
You are consolidating memory for an autonomous software engineering agent. Your job is to distill operational patterns and key learnings from recent work into structured YAML files.

## Input: Recent Journal Entries
$JOURNAL_CONTENT

## Input: Recent Events
$EVENTS_CONTENT

## Existing operational.yaml
$EXISTING_OPERATIONAL

## Existing consolidated-insights.yaml
$EXISTING_INSIGHTS

## Instructions

Analyze the journal entries and events above. Produce EXACTLY two yaml code blocks with no other text. No explanations, no headings, no markdown outside the code blocks.

Block 1 - new operational learnings to add (only genuinely new insights not already in operational.yaml):
\`\`\`yaml
new_learnings:
  - observation: "concise actionable learning"
\`\`\`
Or if none:
\`\`\`yaml
new_learnings: []
\`\`\`

Block 2 - consolidated insights (rolling summary replacing the existing file):
\`\`\`yaml
last_consolidated: "$CONSOLIDATION_TS"
summary: |
  Brief 2-3 sentence summary of recent work.
recurring_themes:
  - theme: "theme name"
    detail: "what keeps coming up"
key_decisions:
  - decision: "what was decided"
    context: "why and when"
active_patterns:
  - pattern: "what the agent does"
    effectiveness: "how well it works"
stale_learnings: []
\`\`\`

Focus on patterns, not individual events. Be concise.
PROMPT_EOF

# Run consolidation via claude -p
# Unset CLAUDECODE to allow running from post-cycle hooks (where the parent
# Claude session has already exited but the env var may linger)
echo "Invoking claude -p for consolidation..."
RESULT=$(unset CLAUDECODE; claude -p --max-turns 1 < "$PROMPT_FILE" 2>/dev/null) || {
  echo "Error: claude -p failed"
  exit 1
}

# ── PARSE AND APPLY RESULTS ──

# Extract YAML blocks by position: first = operational updates, second = insights
# The LLM may put comments like "# operational-updates.yaml" inside the block
BLOCK1=$(echo "$RESULT" | awk '
  /^```yaml$/{block++; capture=1; next}
  /^```$/{if(block==1){exit}; capture=0; next}
  capture {print}
')

BLOCK2=$(echo "$RESULT" | awk '
  /^```yaml$/{block++; capture=1; content=""; next}
  /^```$/{capture=0; next}
  capture && block==2 {print}
')

# Find the next ID for operational.yaml
NEXT_ID=1
if [ -f "$OPERATIONAL_FILE" ]; then
  MAX_ID=$(grep -oP 'id:\s*\K[0-9]+' "$OPERATIONAL_FILE" 2>/dev/null | sort -n | tail -1)
  [ -n "$MAX_ID" ] && NEXT_ID=$((MAX_ID + 1))
fi

# Extract new learnings from first block and append to operational.yaml
LEARNINGS_TO_ADD=$(echo "$BLOCK1" | awk '
  /new_learnings:\s*\[\]/{exit}
  /new_learnings:/{found=1; next}
  found && /observation:/{
    gsub(/^[[:space:]]*-[[:space:]]*observation:[[:space:]]*"?/, "")
    gsub(/"[[:space:]]*$/, "")
    if (length($0) > 0) print
  }
')

TODAY=$(date +%Y-%m-%d)
if [ -n "$LEARNINGS_TO_ADD" ]; then
  echo "Adding new operational learnings..."
  LEARN_COUNT=0
  while IFS= read -r learning; do
    [ -z "$learning" ] && continue
    # Escape quotes for YAML
    learning_escaped=$(echo "$learning" | sed 's/"/\\"/g')
    echo "  - id: $NEXT_ID" >> "$OPERATIONAL_FILE"
    echo "    observation: \"$learning_escaped\"" >> "$OPERATIONAL_FILE"
    echo "    added: \"$TODAY\"" >> "$OPERATIONAL_FILE"
    NEXT_ID=$((NEXT_ID + 1))
    LEARN_COUNT=$((LEARN_COUNT + 1))
  done <<< "$LEARNINGS_TO_ADD"
  echo "Added $LEARN_COUNT new learnings to operational.yaml"
else
  echo "No new operational learnings identified."
fi

# Write consolidated-insights.yaml from second block
# Strip comment lines and unwrap if nested under a top-level key
INSIGHTS_YAML=$(echo "$BLOCK2" | grep -v '^#.*\.yaml$')
# If the LLM wrapped everything under "consolidated-insights:", unwrap it
if echo "$INSIGHTS_YAML" | head -1 | grep -q '^consolidated-insights:'; then
  INSIGHTS_YAML=$(echo "$INSIGHTS_YAML" | tail -n +2 | sed 's/^  //')
fi

if [ -n "$INSIGHTS_YAML" ]; then
  echo "Updating consolidated-insights.yaml..."
  echo "$INSIGHTS_YAML" > "$INSIGHTS_FILE"
  echo "Updated consolidated-insights.yaml"
else
  # Minimal update — at least record the consolidation timestamp
  cat > "$INSIGHTS_FILE" <<EOF
last_consolidated: "$(date -Iseconds)"
summary: |
  Consolidation ran but could not parse structured output from LLM.
recurring_themes: []
key_decisions: []
active_patterns: []
stale_learnings: []
EOF
  echo "Wrote minimal consolidated-insights.yaml (could not parse LLM output)"
fi

# ── LOG ──

bash "$FRAMEWORK_DIR/scripts/log-journal.sh" "$AGENT_DIR" "auto" "system" "output" \
  "Memory consolidation ran ($CYCLES_SINCE cycles). Updated consolidated-insights.yaml and operational.yaml."

bash "$FRAMEWORK_DIR/scripts/log-event.sh" "$AGENT_DIR" "consolidation" \
  "Memory consolidation: $CYCLES_SINCE cycles processed"

echo "Memory consolidation complete."
