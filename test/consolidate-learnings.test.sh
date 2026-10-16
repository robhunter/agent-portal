#!/bin/bash
# consolidate-learnings.test.sh — new learnings land at the end of the learnings: list
# (agent-portal#310).
#
# consolidate-memory.sh appended "  - id: N" entries to the end of operational.yaml.
# In a file whose learnings: list sits at column 0 and is followed by another key,
# the entries landed inside that last key and the file stopped parsing; an
# observation holding a backslash broke the double-quoted scalar it was written in.
#
# The text assertions need nothing but bash. The parse assertions need PyYAML and
# use the memory venv's python when it is installed, else python3; without PyYAML
# they are reported as skipped.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HELPER="$FRAMEWORK_DIR/scripts/consolidate-learnings.py"
PY="$FRAMEWORK_DIR/scripts/memory-venv/bin/python"
[ -x "$PY" ] || PY=python3
HAVE_YAML=0
"$PY" -c "import yaml" 2>/dev/null && HAVE_YAML=1

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }
skip() { echo "  ok - skipped (no PyYAML): $*"; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# yaml_eval <file> <python expression over `d`> — prints the expression's value.
yaml_eval() {
  "$PY" -c 'import sys, yaml; d = yaml.safe_load(open(sys.argv[1], encoding="utf-8")); print(eval(sys.argv[2]))' "$1" "$2"
}

BACKSLASH='split on \s+ before matching'
QUOTED='say "hi" twice'

echo "# a column-0 list followed by another key"
F="$TMP/col0.yaml"
cat > "$F" <<'EOF'
learnings:
- id: 1
  observation: "first"
  added: "2026-01-01"

# What went wrong, by topic
lessons:
- topic: merges
  detail: "wait for the push"
EOF
printf '%s\n%s\n' "$BACKSLASH" "$QUOTED" | "$PY" "$HELPER" "$F" 2 2026-10-06 >/dev/null
cat > "$TMP/col0.want" <<'EOF'
learnings:
- id: 1
  observation: "first"
  added: "2026-01-01"
- id: 2
  observation: "split on \\s+ before matching"
  added: "2026-10-06"
- id: 3
  observation: "say \"hi\" twice"
  added: "2026-10-06"

# What went wrong, by topic
lessons:
- topic: merges
  detail: "wait for the push"
EOF
if diff -u "$TMP/col0.want" "$F" >/dev/null; then
  ok "inserts at the end of the list, at column 0, before the blank line, the comment and lessons:"
else
  fail "unexpected file:"; diff -u "$TMP/col0.want" "$F" | sed 's/^/      /'
fi
if [ "$HAVE_YAML" = 1 ]; then
  [ "$(yaml_eval "$F" '[e["id"] for e in d["learnings"]]')" = "[1, 2, 3]" ] && ok "learnings parse as ids 1, 2, 3" || fail "learnings ids: $(yaml_eval "$F" 'd.get("learnings")')"
  [ "$(yaml_eval "$F" 'd["learnings"][1]["observation"]')" = "$BACKSLASH" ] && ok "a backslash survives the round trip" || fail "backslash observation read back as: $(yaml_eval "$F" 'd["learnings"][1]["observation"]')"
  [ "$(yaml_eval "$F" 'd["learnings"][2]["observation"]')" = "$QUOTED" ] && ok "double quotes survive the round trip" || fail "quoted observation read back as: $(yaml_eval "$F" 'd["learnings"][2]["observation"]')"
  [ "$(yaml_eval "$F" 'd["lessons"]')" = "[{'topic': 'merges', 'detail': 'wait for the push'}]" ] && ok "lessons: is untouched" || fail "lessons: now reads $(yaml_eval "$F" 'd["lessons"]')"
else
  skip "parse checks on the column-0 file"
fi

echo "# a two-space list that is the last key, as the old append assumed"
F="$TMP/last.yaml"
printf 'learnings:\n  - id: 7\n    observation: "a"\n    added: "2026-01-01"\n' > "$F"
printf 'b\n' | "$PY" "$HELPER" "$F" 8 2026-10-06 >/dev/null
printf 'learnings:\n  - id: 7\n    observation: "a"\n    added: "2026-01-01"\n  - id: 8\n    observation: "b"\n    added: "2026-10-06"\n' > "$TMP/last.want"
diff -q "$TMP/last.want" "$F" >/dev/null && ok "appends at the list's two-space indent" || { fail "unexpected file:"; diff -u "$TMP/last.want" "$F" | sed 's/^/      /'; }

echo "# a last line with no newline"
F="$TMP/nonl.yaml"
printf 'learnings:\n  - id: 1\n    observation: "a"\n    added: "2026-01-01"' > "$F"
printf 'b\n' | "$PY" "$HELPER" "$F" 2 2026-10-06 >/dev/null
printf 'learnings:\n  - id: 1\n    observation: "a"\n    added: "2026-01-01"\n  - id: 2\n    observation: "b"\n    added: "2026-10-06"\n' > "$TMP/nonl.want"
diff -q "$TMP/nonl.want" "$F" >/dev/null && ok "ends the last line before adding" || { fail "unexpected file:"; diff -u "$TMP/nonl.want" "$F" | sed 's/^/      /'; }

echo "# learnings: []"
F="$TMP/empty.yaml"
printf 'learnings: []\nlessons: []\n' > "$F"
printf 'b\n' | "$PY" "$HELPER" "$F" 1 2026-10-06 >/dev/null
printf 'learnings:\n  - id: 1\n    observation: "b"\n    added: "2026-10-06"\nlessons: []\n' > "$TMP/empty.want"
diff -q "$TMP/empty.want" "$F" >/dev/null && ok "turns the empty flow list into a block list" || { fail "unexpected file:"; diff -u "$TMP/empty.want" "$F" | sed 's/^/      /'; }

echo "# no operational.yaml yet"
F="$TMP/new/operational.yaml"
mkdir -p "$TMP/new"
printf 'b\n' | "$PY" "$HELPER" "$F" 1 2026-10-06 >/dev/null
printf 'learnings:\n  - id: 1\n    observation: "b"\n    added: "2026-10-06"\n' > "$TMP/new.want"
diff -q "$TMP/new.want" "$F" >/dev/null && ok "creates the file with a learnings: key" || { fail "unexpected file:"; diff -u "$TMP/new.want" "$F" | sed 's/^/      /'; }

echo "# a file the old append created: a bare list"
F="$TMP/bare.yaml"
printf '  - id: 1\n    observation: "a"\n    added: "2026-01-01"\n' > "$F"
printf 'b\n' | "$PY" "$HELPER" "$F" 2 2026-10-06 >/dev/null
printf '  - id: 1\n    observation: "a"\n    added: "2026-01-01"\n  - id: 2\n    observation: "b"\n    added: "2026-10-06"\n' > "$TMP/bare.want"
diff -q "$TMP/bare.want" "$F" >/dev/null && ok "keeps adding items to the bare list" || { fail "unexpected file:"; diff -u "$TMP/bare.want" "$F" | sed 's/^/      /'; }

echo "# a mapping with no learnings: key"
F="$TMP/nokey.yaml"
printf 'lessons:\n- topic: a\n' > "$F"
printf 'b\n' | "$PY" "$HELPER" "$F" 1 2026-10-06 >/dev/null
printf 'lessons:\n- topic: a\nlearnings:\n  - id: 1\n    observation: "b"\n    added: "2026-10-06"\n' > "$TMP/nokey.want"
diff -q "$TMP/nokey.want" "$F" >/dev/null && ok "adds a learnings: key after the others" || { fail "unexpected file:"; diff -u "$TMP/nokey.want" "$F" | sed 's/^/      /'; }

echo "# a file that already does not parse"
F="$TMP/broken.yaml"
printf 'learnings:\n- id: 1\n  observation: "unterminated\n' > "$F"
cp "$F" "$TMP/broken.before"
if [ "$HAVE_YAML" = 1 ]; then
  if printf 'b\n' | "$PY" "$HELPER" "$F" 2 2026-10-06 >/dev/null 2>"$TMP/broken.err"; then
    fail "exited 0 on a file that does not parse"
  else
    ok "exits non-zero"
  fi
  cmp -s "$TMP/broken.before" "$F" && ok "leaves the file byte-for-byte as it was" || fail "changed a file it could not parse"
  grep -q -- "- b" "$TMP/broken.err" && ok "prints the learning it did not add" || fail "the learning it did not add is not in its output"
  [ -z "$(find "$TMP" -name '.operational-*')" ] && ok "leaves no scratch file behind" || fail "scratch file left: $(find "$TMP" -name '.operational-*')"
else
  skip "refusing a file that does not parse"
fi

echo "# consolidate-memory.sh end to end, with a stub claude"
AGENT="$TMP/agent"
mkdir -p "$AGENT/memory" "$AGENT/logs" "$AGENT/journals" "$TMP/bin"
cp "$TMP/col0.want" "$AGENT/memory/operational.yaml"
sed -i '/^- id: [23]$/,+2d' "$AGENT/memory/operational.yaml"
printf '{"ts":"2026-10-06T10:00:00+00:00","type":"cycle_start","summary":"wake"}\n{"ts":"2026-10-06T10:30:00+00:00","type":"work","summary":"merged"}\n' > "$AGENT/logs/events.jsonl"
printf '### 2026-10-06T10:30:00+00:00 | coder | cycle\nmerged a PR\n' > "$AGENT/journals/2026-10.md"
cat > "$TMP/bin/claude" <<'EOF'
#!/bin/bash
cat >/dev/null
cat <<'OUT'
```yaml
new_learnings:
  - observation: "split on \s+ before matching"
  - observation: "say "hi" twice"
```
```yaml
last_consolidated: "2026-10-06T11:00:00+00:00"
summary: |
  Merged a PR.
recurring_themes: []
key_decisions: []
active_patterns: []
stale_learnings: []
```
OUT
EOF
chmod +x "$TMP/bin/claude"
if PATH="$TMP/bin:$PATH" bash "$FRAMEWORK_DIR/scripts/consolidate-memory.sh" "$AGENT" --force >"$TMP/run.log" 2>&1; then
  ok "the consolidation runs to the end"
else
  fail "the consolidation failed:"; sed 's/^/      /' "$TMP/run.log"
fi
if diff -u "$TMP/col0.want" "$AGENT/memory/operational.yaml" >/dev/null; then
  ok "writes the stub's two learnings as ids 2 and 3 at the end of the column-0 list"
else
  fail "unexpected operational.yaml:"; diff -u "$TMP/col0.want" "$AGENT/memory/operational.yaml" | sed 's/^/      /'
fi
grep -q 'last_consolidated: "2026-10-06T11:00:00+00:00"' "$AGENT/memory/consolidated-insights.yaml" && ok "still writes consolidated-insights.yaml" || fail "consolidated-insights.yaml not written"

echo ""
echo "$OK passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
