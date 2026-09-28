const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { sendJSON, readBody, readLastLines, parseJournal, getAllJournalEntries, parseFrontmatter, editJournalEntry } = require('../lib/helpers');

// --- parseJournal ---

describe('parseJournal', () => {
  it('parses valid journal entries', () => {
    const content = `# Journal

### 2026-01-15T10:00:00+00:00 | coder | output

Shipped PR #1 with initial setup.

### 2026-01-20T14:30:00+00:00 | rob | direction

Focus on test coverage next.
`;
    const entries = parseJournal(content);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].ts, '2026-01-15T10:00:00+00:00');
    assert.equal(entries[0].author, 'coder');
    assert.equal(entries[0].tag, 'output');
    assert.equal(entries[0].content, 'Shipped PR #1 with initial setup.');
    assert.equal(entries[1].ts, '2026-01-20T14:30:00+00:00');
    assert.equal(entries[1].author, 'rob');
    assert.equal(entries[1].tag, 'direction');
  });

  it('returns empty array for empty input', () => {
    const entries = parseJournal('');
    assert.deepEqual(entries, []);
  });

  it('returns empty array for content with no entries', () => {
    const entries = parseJournal('# Journal\n\nSome intro text.\n');
    assert.deepEqual(entries, []);
  });

  it('skips entries with malformed headers', () => {
    const content = `# Journal

### This is not a valid header

Some body text.

### 2026-01-15T10:00:00+00:00 | coder | output

Valid entry.

### Missing pipes and stuff

Another invalid entry.
`;
    const entries = parseJournal(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ts, '2026-01-15T10:00:00+00:00');
  });

  it('handles entries with no body content', () => {
    const content = `### 2026-01-15T10:00:00+00:00 | coder | output
`;
    const entries = parseJournal(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, '');
  });

  it('handles entries with multiline content', () => {
    const content = `### 2026-01-15T10:00:00+00:00 | coder | output

Line one.

Line two with **markdown**.

- Bullet point
`;
    const entries = parseJournal(content);
    assert.equal(entries.length, 1);
    assert.ok(entries[0].content.includes('Line one.'));
    assert.ok(entries[0].content.includes('Line two with **markdown**.'));
    assert.ok(entries[0].content.includes('- Bullet point'));
  });
});

// --- getAllJournalEntries ---

describe('getAllJournalEntries', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'journals');

  it('reads and merges entries from multiple monthly files', () => {
    const entries = getAllJournalEntries(fixturesDir);
    assert.equal(entries.length, 5);
    // Should be sorted by timestamp
    for (let i = 1; i < entries.length; i++) {
      assert.ok(entries[i].ts >= entries[i - 1].ts,
        `Entry ${i} (${entries[i].ts}) should be >= entry ${i-1} (${entries[i-1].ts})`);
    }
  });

  it('returns entries from January before February', () => {
    const entries = getAllJournalEntries(fixturesDir);
    const janEntries = entries.filter(e => e.ts.startsWith('2026-01'));
    const febEntries = entries.filter(e => e.ts.startsWith('2026-02'));
    assert.equal(janEntries.length, 3);
    assert.equal(febEntries.length, 2);
  });

  it('returns empty array for nonexistent directory', () => {
    const entries = getAllJournalEntries('/tmp/nonexistent-dir-12345');
    assert.deepEqual(entries, []);
  });

  it('returns empty array for directory with no journal files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Not a journal');
      const entries = getAllJournalEntries(tmpDir);
      assert.deepEqual(entries, []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// --- parseFrontmatter ---

describe('parseFrontmatter', () => {
  it('parses valid YAML frontmatter', () => {
    const content = '---\nstatus: active\npriority: high\n---\n\n# Title\n';
    const fm = parseFrontmatter(content);
    assert.equal(fm.status, 'active');
    assert.equal(fm.priority, 'high');
  });

  it('returns empty object for missing frontmatter', () => {
    const fm = parseFrontmatter('# Just a title\n\nSome content.\n');
    assert.deepEqual(fm, {});
  });

  it('returns empty object for empty content', () => {
    const fm = parseFrontmatter('');
    assert.deepEqual(fm, {});
  });

  it('parses bracket-delimited values as arrays', () => {
    const content = '---\ntags: [backend, api, testing]\n---\n';
    const fm = parseFrontmatter(content);
    assert.ok(Array.isArray(fm.tags));
    assert.deepEqual(fm.tags, ['backend', 'api', 'testing']);
  });

  it('handles keys with hyphens', () => {
    const content = '---\ndue-date: 2026-03-01\n---\n';
    const fm = parseFrontmatter(content);
    assert.equal(fm['due-date'], '2026-03-01');
  });
});

// --- readLastLines ---

describe('readLastLines', () => {
  let tmpFile;

  before(() => {
    tmpFile = path.join(os.tmpdir(), `portal-test-lines-${Date.now()}.txt`);
  });

  after(() => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it('reads last N lines from a file', () => {
    fs.writeFileSync(tmpFile, 'line1\nline2\nline3\nline4\nline5\n');
    const lines = readLastLines(tmpFile, 3);
    assert.deepEqual(lines, ['line3', 'line4', 'line5']);
  });

  it('returns all lines when file has fewer than N lines', () => {
    fs.writeFileSync(tmpFile, 'line1\nline2\n');
    const lines = readLastLines(tmpFile, 10);
    assert.deepEqual(lines, ['line1', 'line2']);
  });

  it('returns empty array for nonexistent file', () => {
    const lines = readLastLines('/tmp/nonexistent-file-12345.txt', 5);
    assert.deepEqual(lines, []);
  });

  it('returns empty array for empty file', () => {
    fs.writeFileSync(tmpFile, '');
    const lines = readLastLines(tmpFile, 5);
    assert.deepEqual(lines, []);
  });

  it('handles file with single line', () => {
    fs.writeFileSync(tmpFile, 'only line');
    const lines = readLastLines(tmpFile, 5);
    assert.deepEqual(lines, ['only line']);
  });
});

// --- sendJSON ---

describe('sendJSON', () => {
  it('sends correct headers and body', (_, done) => {
    const server = http.createServer((req, res) => {
      sendJSON(res, 200, { hello: 'world' });
    });

    server.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/`, (res) => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'application/json');
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          const parsed = JSON.parse(body);
          assert.deepEqual(parsed, { hello: 'world' });
          server.close();
          done();
        });
      });
    });
  });

  it('sends correct status code for errors', (_, done) => {
    const server = http.createServer((req, res) => {
      sendJSON(res, 404, { error: 'Not found' });
    });

    server.listen(0, () => {
      const port = server.address().port;
      http.get(`http://localhost:${port}/`, (res) => {
        assert.equal(res.statusCode, 404);
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          const parsed = JSON.parse(body);
          assert.deepEqual(parsed, { error: 'Not found' });
          server.close();
          done();
        });
      });
    });
  });
});

// --- editJournalEntry ---

// --- journal entries with ### subheadings (#281) ---

const SUBHEADED_JOURNAL = `# Journal — 2026-05

### Preface kept above the first entry

Notes that belong to no entry.

### 2026-05-01T10:00:00.000Z | pm | cycle
Checked the analytics options.

### Google Analytics: no, and here's what to do instead

Server logs already answer the question.

### 2026-05-01T12:00:00.000Z | coder | output

Shipped the fix.

### 2026-05-01T14:00:00.000Z | pm | cycle

Two follow-ups.

### Follow-up one

Details.

### Follow-up two
Last line without a trailing newline`;

function nonSpace(text) {
  return text.replace(/\s+/g, '');
}

function fixtureJournals() {
  const dir = path.join(__dirname, 'fixtures', 'journals');
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => [f, fs.readFileSync(path.join(dir, f), 'utf-8')])
    .concat([['subheaded', SUBHEADED_JOURNAL]]);
}

describe('journal entries containing ### subheadings', () => {
  it('keeps a subheading and the text under it inside the entry it belongs to', () => {
    const entries = parseJournal(SUBHEADED_JOURNAL);
    assert.deepEqual(entries.map(e => e.ts), ['2026-05-01T10:00:00.000Z', '2026-05-01T12:00:00.000Z', '2026-05-01T14:00:00.000Z']);
    assert.equal(entries[0].content, "Checked the analytics options.\n\n### Google Analytics: no, and here's what to do instead\n\nServer logs already answer the question.");
    assert.equal(entries[2].content, 'Two follow-ups.\n\n### Follow-up one\n\nDetails.\n\n### Follow-up two\nLast line without a trailing newline');
  });

  it('loses no text from any journal: preamble plus entries hold every non-blank character of the file', () => {
    for (const [name, content] of fixtureJournals()) {
      const entries = parseJournal(content);
      const firstHeader = content.search(/^### \S+\s*\|/m);
      const preamble = firstHeader === -1 ? content : content.slice(0, firstHeader);
      const read = preamble + entries.map(e => `### ${e.ts}|${e.author}|${e.tag}${e.content}`).join('');
      assert.equal(nonSpace(read), nonSpace(content), name);
    }
  });
});

describe('editJournalEntry on journals with subheadings', () => {
  let dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-edit-'));
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function write(name, content) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
  }

  it('leaves every journal byte for byte the same when an entry is saved unchanged', () => {
    for (const [name, content] of fixtureJournals()) {
      for (const entry of parseJournal(content)) {
        const file = write('same.md', content);
        assert.equal(editJournalEntry(file, entry.ts, entry.content, entry.tag), true);
        assert.equal(fs.readFileSync(file, 'utf-8'), content, `${name} ${entry.ts}`);
      }
    }
  });

  it('changes only the edited entry when the entries around it have subheadings', () => {
    const file = write('middle.md', SUBHEADED_JOURNAL);
    editJournalEntry(file, '2026-05-01T12:00:00.000Z', 'Shipped the fix, and the test.', 'output');
    assert.equal(fs.readFileSync(file, 'utf-8'), SUBHEADED_JOURNAL.replace('Shipped the fix.', 'Shipped the fix, and the test.'));
  });

  it('keeps the preamble, including a ### line above the first entry, when the first entry is edited', () => {
    const file = write('first.md', SUBHEADED_JOURNAL);
    editJournalEntry(file, '2026-05-01T10:00:00.000Z', 'Rewritten.', 'cycle');
    const after = fs.readFileSync(file, 'utf-8');
    assert.ok(after.startsWith('# Journal — 2026-05\n\n### Preface kept above the first entry\n\nNotes that belong to no entry.\n\n### 2026-05-01T10:00:00.000Z | pm | cycle\nRewritten.\n\n### 2026-05-01T12:00:00.000Z'));
    assert.ok(!after.includes('Google Analytics'));
  });

  it('rewrites only the header line when the tag changes', () => {
    const file = write('tag.md', SUBHEADED_JOURNAL);
    editJournalEntry(file, '2026-05-01T14:00:00.000Z', parseJournal(SUBHEADED_JOURNAL)[2].content, 'note');
    assert.equal(fs.readFileSync(file, 'utf-8'), SUBHEADED_JOURNAL.replace('### 2026-05-01T14:00:00.000Z | pm | cycle', '### 2026-05-01T14:00:00.000Z | pm | note'));
  });
});

describe('editJournalEntry', () => {
  let tmpFile;

  before(() => {
    tmpFile = path.join(os.tmpdir(), 'test-edit-journal-' + Date.now() + '.md');
    const content = `# Test Journal — 2026-03

---

### 2026-03-01T10:00:00.000Z | rob | note

Original first entry

### 2026-03-01T12:00:00.000Z | coder | output

Agent output here

### 2026-03-01T14:00:00.000Z | rob | question

Should we do X?
`;
    fs.writeFileSync(tmpFile, content);
  });

  after(() => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  it('edits an existing entry by timestamp', () => {
    const result = editJournalEntry(tmpFile, '2026-03-01T10:00:00.000Z', 'Updated first entry', 'direction');
    assert.equal(result, true);
    const entries = parseJournal(fs.readFileSync(tmpFile, 'utf-8'));
    const edited = entries.find(e => e.ts === '2026-03-01T10:00:00.000Z');
    assert.equal(edited.content, 'Updated first entry');
    assert.equal(edited.tag, 'direction');
    assert.equal(edited.author, 'rob');
  });

  it('preserves other entries when editing', () => {
    const entries = parseJournal(fs.readFileSync(tmpFile, 'utf-8'));
    assert.equal(entries.length, 3);
    const agent = entries.find(e => e.ts === '2026-03-01T12:00:00.000Z');
    assert.equal(agent.content, 'Agent output here');
    assert.equal(agent.author, 'coder');
  });

  it('returns false for nonexistent timestamp', () => {
    const result = editJournalEntry(tmpFile, '1999-01-01T00:00:00.000Z', 'nope', 'note');
    assert.equal(result, false);
  });

  it('returns false for nonexistent file', () => {
    const result = editJournalEntry('/nonexistent/file.md', '2026-03-01T10:00:00.000Z', 'nope', 'note');
    assert.equal(result, false);
  });
});
