#!/bin/bash
set -e
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"

python3 - "$FRAMEWORK_DIR" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

FRAMEWORK = Path(sys.argv.pop())


class ConsolidationEvents(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="consolidation-events-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.agent = self.root / "agent"
        self.data = self.agent / "data"
        for name in ("memory", "logs", "journals"):
            (self.data / name).mkdir(parents=True)
        (self.agent / "portal.config.json").write_text(json.dumps({"dataDir": "data"}))
        (self.data / "memory/config.yaml").write_text("cycle_threshold: 2\n")
        self.events = self.data / "logs/events.jsonl"
        self.prompt = self.root / "prompt"
        self.calls = self.root / "calls"
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "claude"
        stub.write_text('''#!/bin/bash
cat > "$CAPTURE_PROMPT"
echo called >> "$CAPTURE_CALLS"
cat <<'YAML'
```yaml
new_learnings: []
```
```yaml
last_consolidated: "2026-06-15T18:00:00Z"
summary: "Fixture consolidation"
```
YAML
''')
        stub.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}",
                        DATA_DIR="data", CAPTURE_PROMPT=str(self.prompt),
                        CAPTURE_CALLS=str(self.calls))

    def write_events(self, events, spaced):
        separators = (" , ", " \t: \t") if spaced else (",", ":")
        self.events.write_text("".join(json.dumps(e, separators=separators) + "\n"
                                       for e in events))

    def watermark(self):
        (self.data / "memory/consolidated-insights.yaml").write_text(
            'last_consolidated: "2026-06-15T13:00:00Z"\n')

    def run_script(self, force=False):
        result = subprocess.run(
            ["bash", str(FRAMEWORK / "scripts/consolidate-memory.sh"),
             str(self.agent)] + (["--force"] if force else []),
            env=self.env, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "", result.stderr)
        return result.stdout

    def check_input(self, spaced, incremental):
        if incremental:
            self.watermark()
        events = [
            {"ts": "2026-06-15T12:00:00Z", "type": "cycle_start", "summary": "old wake"},
            {"ts": "2026-06-15T12:30:00Z", "type": "work", "summary": "old work"},
            {"ts": "2026-06-15T07:00:00-07:00", "type": "cycle_start", "summary": "new wake"},
            {"ts": "2026-06-15T15:00:00Z", "type": "cycle_start", "summary": "next wake"},
            {"summary": "work included", "type": "work", "ts": "2026-06-15T15:01:00Z"},
            {"ts": "2026-06-15T15:02:00Z", "type": "error", "summary": "error included"},
            {"ts": "2026-06-15T15:03:00Z", "type": "dissonance", "summary": "reflection included"},
            {"ts": "2026-06-15T15:04:00Z", "type": "cycle_end", "summary": "ignored end"},
            {"ts": "2026-06-15T15:05:00Z", "type": "work_extra", "summary": "ignored type prefix"},
        ]
        self.write_events(events, spaced)
        stdout = self.run_script()
        count = 2 if incremental else 3
        self.assertIn(f"Running memory consolidation: {count} cycles", stdout)
        prompt = self.prompt.read_text()
        body = prompt.split("## Input: Recent Events\n", 1)[1].split(
            "\n## Existing operational.yaml", 1)[0].strip()
        expected = [e for e in events if e["type"] in {"work", "error", "dissonance"}]
        if incremental:
            expected = expected[1:]
        self.assertEqual([json.loads(line) for line in body.splitlines()], expected)
        self.assertIn("Memory consolidation complete.", stdout)
        self.assertEqual(self.calls.read_text(), "called\n")
        self.assertTrue(any((self.data / "journals").glob("*.md")))
        self.assertFalse((self.agent / "logs").exists())
        # The emitted watermark must prevent an immediate repeat model call.
        self.assertIn("Consolidation not needed: 0 cycles", self.run_script())
        self.assertEqual(self.calls.read_text(), "called\n")

    def test_compact_initial(self):
        self.check_input(spaced=False, incremental=False)

    def test_whitespace_initial(self):
        self.check_input(spaced=True, incremental=False)

    def test_compact_incremental(self):
        self.check_input(spaced=False, incremental=True)

    def test_whitespace_incremental(self):
        self.check_input(spaced=True, incremental=True)

    def test_threshold_excludes_old_and_equal_timestamps(self):
        self.watermark()
        self.write_events([
            {"ts": ts, "type": "cycle_start", "summary": "wake"}
            for ts in ("2026-06-15T12:00:00Z", "2026-06-15T13:00:00Z",
                       "2026-06-15T07:00:00-07:00")], spaced=True)
        self.assertIn("Consolidation not needed: 1 cycles", self.run_script())
        self.assertFalse(self.calls.exists())

    def test_empty_and_missing_logs(self):
        # Journal input would start a model call if the count bypassed the threshold.
        (self.data / "journals/2026-06.md").write_text(
            "### 2026-06-15T14:00:00Z | tester | cycle\nFixture journal\n")
        for exists in (False, True):
            for incremental in (False, True):
                with self.subTest(log_exists=exists, incremental=incremental):
                    self.calls.unlink(missing_ok=True)
                    self.prompt.unlink(missing_ok=True)
                    insights = self.data / "memory/consolidated-insights.yaml"
                    insights.unlink(missing_ok=True)
                    self.events.unlink(missing_ok=True)
                    if exists:
                        self.events.touch()
                    if incremental:
                        self.watermark()
                    self.assertIn("Consolidation not needed: 0 cycles", self.run_script())
                    self.assertFalse(self.calls.exists())

    def test_forced_run_keeps_whitespace_events_below_threshold(self):
        self.watermark()
        event = {"ts": "2026-06-15T14:00:00Z", "type": "work", "summary": "forced work"}
        self.write_events([event], spaced=True)
        self.run_script(force=True)
        self.assertIn("forced work", self.prompt.read_text())


unittest.main(verbosity=2)
PY
