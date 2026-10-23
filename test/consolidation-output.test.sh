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
VALID = '''last_consolidated: "2026-06-16T15:00:00Z"
summary: "New consolidated context"
recurring_themes: []
key_decisions: []
active_patterns: []
stale_learnings: []
'''
LEARNING = '''```yaml
new_learnings:
  - observation: "Keep the retryable input"
```
'''


class ConsolidationOutput(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="consolidation-output-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.agent = self.root / "agent"
        self.data = self.agent / "data"
        for name in ("memory", "logs", "journals"):
            (self.data / name).mkdir(parents=True)
        (self.agent / "portal.config.json").write_text(json.dumps({"dataDir": "data"}))
        (self.data / "memory/config.yaml").write_text("cycle_threshold: 1\n")
        self.insights = self.data / "memory/consolidated-insights.yaml"
        self.insights.write_text('last_consolidated: "2026-06-15T13:00:00Z"\n'
                                 'summary: "Saved verified context"\n')
        self.insights.chmod(0o640)
        self.operational = self.data / "memory/operational.yaml"
        self.operational.write_text('learnings:\n- id: 1\n  observation: "Existing learning"\n')
        self.events = self.data / "logs/events.jsonl"
        self.events.write_text(''.join(json.dumps(e) + '\n' for e in [
            {"ts": "2026-06-16T12:00:00Z", "type": "cycle_start", "summary": "wake"},
            {"ts": "2026-06-16T12:01:00Z", "type": "work", "summary": "Work awaiting consolidation"},
        ]))
        self.journal = self.data / "journals/2026-06.md"
        self.journal.write_text('### 2026-06-16T12:02:00Z | tester | cycle\n'
                                'Journal awaiting consolidation\n')
        self.response = self.root / "response"
        self.prompt = self.root / "prompt"
        self.calls = self.root / "calls"
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "claude"
        stub.write_text('''#!/bin/sh
cat > "$CAPTURE_PROMPT"
echo called >> "$CAPTURE_CALLS"
cat "$MODEL_RESPONSE"
''')
        stub.chmod(0o755)
        self.env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}",
                        DATA_DIR="wrong-inherited-directory", CAPTURE_PROMPT=str(self.prompt),
                        CAPTURE_CALLS=str(self.calls), MODEL_RESPONSE=str(self.response))

    def run_script(self, response, force=False):
        self.response.write_text(response)
        return subprocess.run(
            ["bash", str(FRAMEWORK / "scripts/consolidate-memory.sh"), str(self.agent)] +
            (["--force"] if force else []), env=self.env, text=True,
            capture_output=True, timeout=30)

    def snapshot(self):
        return {str(p.relative_to(self.data)): p.read_bytes()
                for p in self.data.rglob('*') if p.is_file()}

    def reject(self, response):
        before = self.snapshot()
        result = self.run_script(response)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Invalid consolidation insights:", result.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertNotIn("Memory consolidation complete.", result.stdout)
        self.assertEqual(list(self.data.rglob('*.tmp.*')), [])
        return self.prompt.read_text()

    def test_missing_second_block_preserves_state_and_retry_input(self):
        before_prompt = self.reject(LEARNING)
        result = self.run_script(LEARNING + '```yaml\n' + VALID + '```\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stderr, '')
        self.assertEqual(self.prompt.read_text(), before_prompt)
        self.assertIn('Work awaiting consolidation', before_prompt)
        self.assertIn('Journal awaiting consolidation', before_prompt)
        self.assertIn('New consolidated context', self.insights.read_text())
        self.assertIn('Keep the retryable input', self.operational.read_text())
        self.assertEqual(self.insights.stat().st_mode & 0o777, 0o640)
        self.assertEqual(self.calls.read_text(), 'called\ncalled\n')
        self.assertEqual(sum(json.loads(line)['type'] == 'consolidation'
                             for line in self.events.read_text().splitlines()), 1)
        self.assertEqual(sum(p.read_text().count('Memory consolidation ran')
                             for p in (self.data / 'journals').glob('*.md')), 1)
        repeat = self.run_script('must not be called')
        self.assertEqual(repeat.returncode, 0, repeat.stdout + repeat.stderr)
        self.assertIn('Consolidation not needed: 0 cycles', repeat.stdout)
        self.assertEqual(self.calls.read_text(), 'called\ncalled\n')
        self.assertFalse((self.agent / 'wrong-inherited-directory').exists())
        self.assertEqual(list(self.data.rglob('*.tmp.*')), [])

    def test_plain_text_and_empty_response_are_rejected(self):
        for response in ('', 'The model returned an explanation instead of YAML.\n'):
            with self.subTest(response=response):
                self.reject(response)

    def test_malformed_second_block_is_rejected(self):
        self.reject(LEARNING + '```yaml\nsummary: [unterminated\n```\n')

    def test_non_mapping_second_block_is_rejected(self):
        for body in ('null', 'plain scalar', '- list item', ''):
            with self.subTest(body=body):
                self.reject(LEARNING + '```yaml\n' + body + '\n```\n')

    def test_invalid_watermarks_are_rejected(self):
        for timestamp in ('not-a-date', '2026-06-16', '2026-06-16T15:00:00',
                          '2026-99-16T15:00:00Z', '2026-02-30T15:00:00Z', '', 42, None):
            with self.subTest(timestamp=timestamp):
                body = json.dumps({'last_consolidated': timestamp, 'summary': 'context'})
                self.reject(LEARNING + '```yaml\n' + body + '\n```\n')
        self.reject(LEARNING + '```yaml\nsummary: context\n```\n')

    def test_missing_or_invalid_summary_is_rejected(self):
        for summary in ('', ' \t ', [], None):
            with self.subTest(summary=summary):
                body = json.dumps({'last_consolidated': '2026-06-16T15:00:00Z', 'summary': summary})
                self.reject(LEARNING + '```yaml\n' + body + '\n```\n')
        self.reject(LEARNING + '```yaml\nlast_consolidated: "2026-06-16T15:00:00Z"\n```\n')

    def test_optional_sections_must_be_lists(self):
        for key in ('recurring_themes', 'key_decisions', 'active_patterns', 'stale_learnings'):
            with self.subTest(key=key):
                self.reject(LEARNING + '```yaml\n' + VALID.replace(key + ': []', key + ': broken') + '```\n')

    def test_wrapped_insights_are_saved_as_a_top_level_mapping(self):
        body = 'consolidated-insights:\n' + ''.join('  ' + line + '\n' for line in VALID.splitlines())
        result = self.run_script(LEARNING + '```yaml\n# consolidated-insights.yaml\n' + body + '```\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        saved = self.insights.read_text()
        self.assertTrue(saved.startswith('last_consolidated:'), saved)
        self.assertIn('New consolidated context', saved)
        self.assertNotIn('consolidated-insights:', saved)

    def test_first_run_rejection_creates_no_memory_or_success_records(self):
        self.insights.unlink()
        self.operational.unlink()
        self.reject('empty model output')
        self.assertFalse(self.insights.exists())
        self.assertFalse(self.operational.exists())


unittest.main(verbosity=2)
PY
