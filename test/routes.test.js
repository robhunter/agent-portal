const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');

// Create a test server with fixtures
function createTestServer(configOverrides = {}) {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const config = {
    name: 'Test',
    port: 0,
    agentDir: fixturesDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-portal-lock-nonexistent',
    _serverStartTime: Date.now(),
    authors: { rob: { color: '#1565c0', bg: '#e3f2fd' }, coder: { color: '#4527a0', bg: '#ede7f6' } },
    features: {},
    ...configOverrides,
  };

  const routes = {};
  require('../lib/routes/status').register(routes, config);
  require('../lib/routes/journal').register(routes, config);
  require('../lib/routes/events').register(routes, config);
  require('../lib/routes/github').register(routes, config);
  require('../lib/routes/cycle').register(routes, config);
  require('../lib/routes/roadmap').register(routes, config);
  require('../lib/routes/health').register(routes, config);
  require('../lib/routes/requests').register(routes, config);
  require('../lib/routes/projects').register(routes, config);
  require('../lib/routes/outputs').register(routes, config);
  require('../lib/routes/deploy').register(routes, config);
  require('../lib/routes/claude').register(routes, config);

  return { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }), config };
}

async function fetchJSON(port, path, options = {}) {
  const res = await fetch(`http://localhost:${port}${path}`, options);
  const data = await res.json();
  return { status: res.status, data };
}

describe('GET /api/status', () => {
  let server, port;

  before(async () => {
    const result = createTestServer();
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns services, git, and serverTime', async () => {
    const { status, data } = await fetchJSON(port, '/api/status');
    assert.equal(status, 200);
    assert.ok(data.services);
    assert.ok(data.services['portal-server']);
    assert.equal(data.services['portal-server'].alive, true);
    assert.ok(data.git);
    assert.ok(data.serverTime);
  });

  it('returns lastWake from events.jsonl', async () => {
    const { data } = await fetchJSON(port, '/api/status');
    assert.ok(data.lastWake);
    assert.equal(data.lastWake.type, 'cycle_end');
  });
});

describe('GET /api/next-run', () => {
  let server, port;

  before(async () => {
    const result = createTestServer();
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns cron info (error for nonexistent file is acceptable)', async () => {
    const { status, data } = await fetchJSON(port, '/api/next-run');
    assert.equal(status, 200);
    assert.ok('installed' in data);
  });
});

describe('GET /api/today', () => {
  let server, port;

  before(async () => {
    const result = createTestServer();
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns today.md content', async () => {
    const { status, data } = await fetchJSON(port, '/api/today');
    assert.equal(status, 200);
    assert.ok(data.content.includes("Today's Priorities"));
  });
});

describe('GET /api/journal', () => {
  let server, port;

  before(async () => {
    const result = createTestServer();
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns parsed entries sorted by timestamp', async () => {
    const { status, data } = await fetchJSON(port, '/api/journal');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.entries));
    assert.equal(data.entries.length, 5);
    // Verify sorted
    for (let i = 1; i < data.entries.length; i++) {
      assert.ok(data.entries[i].ts >= data.entries[i - 1].ts);
    }
  });
});

describe('POST /api/journal', () => {
  let server, port, tmpDir;

  before(async () => {
    // Create temp directory with journals subdir
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-journal-test-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));

    const result = createTestServer({ agentDir: tmpDir });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates journal entry with correct format', async () => {
    const { status, data } = await fetchJSON(port, '/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test entry content', tag: 'note' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.tag, 'note');
    assert.ok(data.ts);

    // Verify file was created
    const now = new Date();
    const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.md`;
    const content = fs.readFileSync(path.join(tmpDir, 'journals', filename), 'utf-8');
    assert.ok(content.includes('### '));
    assert.ok(content.includes('| rob | note'));
    assert.ok(content.includes('Test entry content'));
  });

  it('rejects empty text', async () => {
    const { status, data } = await fetchJSON(port, '/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '', tag: 'note' }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('required'));
  });

  it('rejects invalid tag', async () => {
    const { status, data } = await fetchJSON(port, '/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Some text', tag: 'invalid' }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('Invalid tag'));
  });

  it('rejects invalid JSON', async () => {
    const { status, data } = await fetchJSON(port, '/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('Invalid JSON'));
  });
});

describe('GET /api/events', () => {
  let server, port;

  before(async () => {
    const result = createTestServer();
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns parsed JSONL entries', async () => {
    const { status, data } = await fetchJSON(port, '/api/events');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 3);
    assert.equal(data[0].type, 'cycle_start');
  });
});

describe('GET /api/wins', () => {
  let server, port;

  before(async () => {
    const result = createTestServer();
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns wins from last 30 days', async () => {
    const { status, data } = await fetchJSON(port, '/api/wins');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    // Fixture win is from 2026-02-01 which may or may not be within 30 days
    // depending on when tests run — just verify it's an array
  });
});

describe('GET /api/github/* (no repos configured)', () => {
  let server, port;

  before(async () => {
    const result = createTestServer(); // features: {} means no github
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns empty items for /api/github/issues', async () => {
    const { status, data } = await fetchJSON(port, '/api/github/issues');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.items));
    assert.equal(data.items.length, 0);
  });

  it('returns empty items for /api/github/prs', async () => {
    const { status, data } = await fetchJSON(port, '/api/github/prs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.items));
    assert.equal(data.items.length, 0);
  });
});

describe('POST /api/cron/toggle', () => {
  let server, port, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-cron-test-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));
    const cronFile = path.join(tmpDir, 'test-cron');
    fs.writeFileSync(cronFile, '# cron test\n0 */2 * * * root bash /root/scripts/wake.sh\n');

    const result = createTestServer({ agentDir: tmpDir, cronFile });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('disables cron by commenting wake.sh line', async () => {
    const { status, data } = await fetchJSON(port, '/api/cron/toggle', {
      method: 'POST',
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.enabled, false);
  });

  it('enables cron by uncommenting wake.sh line', async () => {
    const { status, data } = await fetchJSON(port, '/api/cron/toggle', {
      method: 'POST',
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.enabled, true);
  });
});

describe('POST /api/cycle/run', () => {
  let server, port;

  before(async () => {
    // Use a lock file that won't exist (so lock check says "not running")
    const result = createTestServer({ lockFile: '/tmp/test-portal-lock-nonexistent-cycle' });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns 200 when no cycle is running (wake.sh may not exist but spawn succeeds)', async () => {
    const { status, data } = await fetchJSON(port, '/api/cycle/run', {
      method: 'POST',
    });
    // Should return 200 OK (spawn will succeed even if script doesn't exist)
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });
});

describe('POST /api/cycle/respond', () => {
  let server, port;

  before(async () => {
    const result = createTestServer({ lockFile: '/tmp/test-portal-lock-nonexistent-respond' });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns 404 when respond.sh does not exist', async () => {
    const { status, data } = await fetchJSON(port, '/api/cycle/respond', {
      method: 'POST',
    });
    assert.equal(status, 404);
    assert.ok(data.error.includes('respond.sh not found'));
  });
});

describe('GET /api/roadmap', () => {
  it('returns roadmap.md content when feature enabled', async () => {
    const result = createTestServer({ features: { roadmap: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/roadmap');
    assert.equal(status, 200);
    assert.ok(data.content.includes('Product Roadmap'));
    assert.ok(data.content.includes('Launch agent portal'));

    server.close();
  });

  it('returns 404 when feature disabled', async () => {
    const result = createTestServer({ features: {} });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/roadmap');
    assert.equal(status, 404);

    server.close();
  });

  it('returns fallback content when roadmap.md missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-roadmap-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));

    const result = createTestServer({ agentDir: tmpDir, features: { roadmap: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/roadmap');
    assert.equal(status, 200);
    assert.ok(data.content.includes('No roadmap.md found'));

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('GET /api/health', () => {
  it('returns health entries when feature enabled', async () => {
    const result = createTestServer({ features: { health: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/health');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 3);
    assert.equal(data[0].project, 'agentdeals');
    assert.equal(data[0].ok, true);
    assert.equal(data[2].ok, false);
    assert.equal(data[2].status, 500);

    server.close();
  });

  it('returns 404 when feature disabled', async () => {
    const result = createTestServer({ features: {} });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/health');
    assert.equal(status, 404);

    server.close();
  });

  it('returns empty array when health.jsonl missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-health-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));

    const result = createTestServer({ agentDir: tmpDir, features: { health: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/health');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 0);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('GET /api/requests', () => {
  it('returns request files with metadata when feature enabled', async () => {
    const result = createTestServer({ features: { requests: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/requests');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.items));
    assert.equal(data.items.length, 3);
    // Sorted alphabetically by filename
    assert.equal(data.items[0].file, 'add-logging.md');
    assert.equal(data.items[0].status, 'pending');
    assert.ok(data.items[0].title.includes('Add structured logging'));
    assert.equal(data.items[1].file, 'deploy-automation.md');
    assert.equal(data.items[1].status, 'completed');
    assert.equal(data.items[2].file, 'improve-tests.md');
    assert.equal(data.items[2].status, 'approved');

    server.close();
  });

  it('returns 404 when feature disabled', async () => {
    const result = createTestServer({ features: {} });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/requests');
    assert.equal(status, 404);

    server.close();
  });

  it('returns empty items when requests dir missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-requests-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));

    const result = createTestServer({ agentDir: tmpDir, features: { requests: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/requests');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.items));
    assert.equal(data.items.length, 0);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('POST /api/requests/reply', () => {
  let server, port, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-reply-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));
    fs.mkdirSync(path.join(tmpDir, 'requests'));
    fs.writeFileSync(path.join(tmpDir, 'requests', 'test-request.md'),
      '# Request: Test feature\n\n**Status:** pending\n**Filed:** 2026-02-20\n\nPlease add test feature.\n');

    const result = createTestServer({ agentDir: tmpDir, features: { requests: true } });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('appends reply to request file and cross-posts to journal', async () => {
    const { status, data } = await fetchJSON(port, '/api/requests/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'test-request.md', comment: 'Approved, proceed.' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.ok(data.ts);

    // Verify reply appended to request file
    const reqContent = fs.readFileSync(path.join(tmpDir, 'requests', 'test-request.md'), 'utf-8');
    assert.ok(reqContent.includes('## Response'));
    assert.ok(reqContent.includes('Approved, proceed.'));

    // Verify cross-post to journal
    const now = new Date();
    const journalFile = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.md`;
    const journalContent = fs.readFileSync(path.join(tmpDir, 'journals', journalFile), 'utf-8');
    assert.ok(journalContent.includes('rob | direction'));
    assert.ok(journalContent.includes('Re: Test feature'));
    assert.ok(journalContent.includes('Approved, proceed.'));
  });

  it('rejects missing file field', async () => {
    const { status, data } = await fetchJSON(port, '/api/requests/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Hello' }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('required'));
  });

  it('rejects path traversal', async () => {
    const { status, data } = await fetchJSON(port, '/api/requests/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: '../../../etc/passwd', comment: 'attack' }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('Invalid filename'));
  });

  it('returns 404 for nonexistent request file', async () => {
    const { status, data } = await fetchJSON(port, '/api/requests/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'nonexistent.md', comment: 'Hello' }),
    });
    assert.equal(status, 404);
    assert.ok(data.error.includes('not found'));
  });
});

// --- Project routes ---

describe('GET /api/projects', () => {
  it('returns project list sorted by priority when sidebar.type is projects', async () => {
    const result = createTestServer({
      sidebar: { type: 'projects', projectsDir: 'projects' },
    });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/projects');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 3);
    // Sorted: high, medium, low
    assert.equal(data[0].priority, 'high');
    assert.equal(data[0].slug, 'alpha-feature');
    assert.equal(data[0].title, 'Alpha Feature');
    assert.equal(data[0].entryCount, 3);
    assert.ok(data[0].lastActivity);
    assert.equal(data[1].priority, 'medium');
    assert.equal(data[1].slug, 'beta-cleanup');
    assert.equal(data[2].priority, 'low');
    assert.equal(data[2].slug, 'gamma-docs');

    server.close();
  });

  it('returns 404 when sidebar.type is not projects', async () => {
    const result = createTestServer({ features: {} });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/projects');
    assert.equal(status, 404);

    server.close();
  });

  it('parses frontmatter tags as arrays', async () => {
    const result = createTestServer({
      sidebar: { type: 'projects', projectsDir: 'projects' },
    });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { data } = await fetchJSON(port, '/api/projects');
    const alpha = data.find(p => p.slug === 'alpha-feature');
    assert.ok(Array.isArray(alpha.tags));
    assert.deepEqual(alpha.tags, ['backend', 'api']);

    server.close();
  });
});

describe('GET /api/projects/:slug/journal', () => {
  let server, port;

  before(async () => {
    const result = createTestServer({
      sidebar: { type: 'projects', projectsDir: 'projects' },
    });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns per-project journal entries', async () => {
    const { status, data } = await fetchJSON(port, '/api/projects/alpha-feature/journal');
    assert.equal(status, 200);
    assert.equal(data.slug, 'alpha-feature');
    assert.ok(Array.isArray(data.entries));
    assert.equal(data.entries.length, 3);
    assert.equal(data.entries[0].author, 'bobbo');
    assert.equal(data.entries[0].tag, 'output');
  });

  it('returns empty entries for project with no journal', async () => {
    const { status, data } = await fetchJSON(port, '/api/projects/gamma-docs/journal');
    assert.equal(status, 200);
    assert.equal(data.slug, 'gamma-docs');
    assert.deepEqual(data.entries, []);
  });
});

describe('POST /api/projects/:slug/journal', () => {
  let server, port, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-proj-journal-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));
    fs.mkdirSync(path.join(tmpDir, 'projects'));
    fs.writeFileSync(path.join(tmpDir, 'projects', 'test-proj.md'), '---\nstatus: active\npriority: high\n---\n\n# Test Proj\n');

    const result = createTestServer({
      agentDir: tmpDir,
      sidebar: { type: 'projects', projectsDir: 'projects' },
    });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates per-project journal entry', async () => {
    const { status, data } = await fetchJSON(port, '/api/projects/test-proj/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Project journal test', tag: 'note' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.tag, 'note');

    const content = fs.readFileSync(path.join(tmpDir, 'journals', 'test-proj.md'), 'utf-8');
    assert.ok(content.includes('Test Proj — Journal'));
    assert.ok(content.includes('rob | note'));
    assert.ok(content.includes('Project journal test'));
  });

  it('rejects invalid tag', async () => {
    const { status, data } = await fetchJSON(port, '/api/projects/test-proj/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Something', tag: 'bad' }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('Invalid tag'));
  });
});

describe('GET /api/projects/:slug/file', () => {
  let server, port;

  before(async () => {
    const result = createTestServer({
      sidebar: { type: 'projects', projectsDir: 'projects' },
    });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns raw project file content', async () => {
    const { status, data } = await fetchJSON(port, '/api/projects/alpha-feature/file');
    assert.equal(status, 200);
    assert.equal(data.slug, 'alpha-feature');
    assert.ok(data.content.includes('# Alpha Feature'));
    assert.ok(data.content.includes('priority: high'));
  });

  it('returns 404 for nonexistent project', async () => {
    const { status, data } = await fetchJSON(port, '/api/projects/nonexistent/file');
    assert.equal(status, 404);
    assert.ok(data.error.includes('not found'));
  });
});

// --- Output routes ---

describe('GET /api/outputs', () => {
  it('returns output files with review status when feature enabled', async () => {
    const result = createTestServer({ features: { outputs: true, feedback: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/outputs');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 3);
    // Should be sorted by modification date (newest first)
    assert.ok(data.every(o => o.filename.endsWith('.md')));
    // alpha-feature-api-endpoints has feedback
    const reviewed = data.find(o => o.filename === 'alpha-feature-api-endpoints.md');
    assert.ok(reviewed);
    assert.equal(reviewed.reviewed, true);
    assert.equal(reviewed.rating, 'up');
    // beta-cleanup has no feedback
    const unreviewed = data.find(o => o.filename === 'beta-cleanup-deprecated.md');
    assert.ok(unreviewed);
    assert.equal(unreviewed.reviewed, false);

    server.close();
  });

  it('returns 404 when feature disabled', async () => {
    const result = createTestServer({ features: {} });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/outputs');
    assert.equal(status, 404);

    server.close();
  });
});

describe('GET /api/output/:filename', () => {
  let server, port;

  before(async () => {
    const result = createTestServer({ features: { outputs: true } });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('returns output file content', async () => {
    const { status, data } = await fetchJSON(port, '/api/output/alpha-feature-api-endpoints.md');
    assert.equal(status, 200);
    assert.equal(data.filename, 'alpha-feature-api-endpoints.md');
    assert.ok(data.content.includes('API Endpoints'));
  });

  it('returns 404 for nonexistent output', async () => {
    const { status } = await fetchJSON(port, '/api/output/nonexistent.md');
    assert.equal(status, 404);
  });

  it('rejects path traversal', async () => {
    const { status, data } = await fetchJSON(port, '/api/output/..%2F..%2Fetc%2Fpasswd');
    assert.equal(status, 400);
    assert.ok(data.error.includes('Invalid filename'));
  });
});

describe('DELETE /api/output/:filename', () => {
  let server, port, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-output-del-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));
    fs.mkdirSync(path.join(tmpDir, 'output'));
    fs.mkdirSync(path.join(tmpDir, 'input', 'feedback'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'output', 'delete-me.md'), '# To delete');
    fs.writeFileSync(path.join(tmpDir, 'input', 'feedback', 'delete-me.feedback.yaml'), 'rating: up\n');

    const result = createTestServer({ agentDir: tmpDir, features: { outputs: true } });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('deletes output and associated feedback', async () => {
    const { status, data } = await fetchJSON(port, '/api/output/delete-me.md', { method: 'DELETE' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.deleted, 'delete-me.md');
    // Verify both files removed
    assert.ok(!fs.existsSync(path.join(tmpDir, 'output', 'delete-me.md')));
    assert.ok(!fs.existsSync(path.join(tmpDir, 'input', 'feedback', 'delete-me.feedback.yaml')));
  });
});

// --- Feedback routes ---

describe('POST /api/feedback/:filename', () => {
  let server, port, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-feedback-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));
    fs.mkdirSync(path.join(tmpDir, 'input', 'feedback'), { recursive: true });

    const result = createTestServer({ agentDir: tmpDir, features: { feedback: true } });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates feedback YAML file with thumbs up', async () => {
    const { status, data } = await fetchJSON(port, '/api/feedback/test-output.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 2, notes: 'Great work' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.file, 'test-output.feedback.yaml');

    const content = fs.readFileSync(path.join(tmpDir, 'input', 'feedback', 'test-output.feedback.yaml'), 'utf-8');
    assert.ok(content.includes('rating: up'));
    assert.ok(content.includes('Great work'));
  });

  it('creates feedback with thumbs down', async () => {
    const { status, data } = await fetchJSON(port, '/api/feedback/bad-output.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 1 }),
    });
    assert.equal(status, 200);
    const content = fs.readFileSync(path.join(tmpDir, 'input', 'feedback', 'bad-output.feedback.yaml'), 'utf-8');
    assert.ok(content.includes('rating: down'));
  });

  it('creates feedback with notes only (no rating)', async () => {
    const { status, data } = await fetchJSON(port, '/api/feedback/notes-only.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Just a comment' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    const content = fs.readFileSync(path.join(tmpDir, 'input', 'feedback', 'notes-only.feedback.yaml'), 'utf-8');
    assert.ok(!content.includes('rating:'));
    assert.ok(content.includes('Just a comment'));
  });

  it('rejects invalid rating', async () => {
    const { status, data } = await fetchJSON(port, '/api/feedback/test.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5 }),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('Rating must be'));
  });

  it('rejects empty feedback', async () => {
    const { status, data } = await fetchJSON(port, '/api/feedback/test.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(status, 400);
    assert.ok(data.error.includes('Provide a rating'));
  });
});

describe('GET /api/feedback/:filename', () => {
  it('returns existing feedback', async () => {
    const result = createTestServer({ features: { feedback: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/feedback/alpha-feature-api-endpoints.md');
    assert.equal(status, 200);
    assert.ok(data.content.includes('rating: up'));

    server.close();
  });

  it('returns 404 for missing feedback', async () => {
    const result = createTestServer({ features: { feedback: true } });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/feedback/no-feedback.md');
    assert.equal(status, 404);

    server.close();
  });
});

// --- Deploy routes ---

describe('POST /api/deploy', () => {
  let server, port, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-deploy-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));

    const result = createTestServer({
      agentDir: tmpDir,
      name: 'TestAgent',
      features: { deploy: true, deploySignalFile: path.join(tmpDir, 'deploy-signal') },
    });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes deploy signal file', async () => {
    const { status, data } = await fetchJSON(port, '/api/deploy', { method: 'POST' });
    assert.equal(status, 202);
    assert.equal(data.ok, true);
    assert.ok(data.message.includes('Deploy requested'));
    // Verify signal file was written
    const content = fs.readFileSync(path.join(tmpDir, 'deploy-signal'), 'utf-8');
    assert.ok(content.match(/^\d{4}-/)); // ISO timestamp
  });

  it('returns 404 when feature disabled', async () => {
    const result = createTestServer({ features: {} });
    const server2 = result.server;
    await new Promise(resolve => server2.listen(0, resolve));
    const port2 = server2.address().port;

    const { status } = await fetchJSON(port2, '/api/deploy', { method: 'POST' });
    assert.equal(status, 404);

    server2.close();
  });
});

describe('POST /api/services/:name/restart', () => {
  let server, port;

  before(async () => {
    const result = createTestServer({
      features: { serviceRestart: ['review-server', 'telegram-poller'] },
    });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('accepts valid service name', async () => {
    // telegram-poller won't actually restart (no PID file), but route accepts it
    const { status, data } = await fetchJSON(port, '/api/services/telegram-poller/restart', { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  });

  it('rejects unknown service name', async () => {
    const { status, data } = await fetchJSON(port, '/api/services/unknown-service/restart', { method: 'POST' });
    assert.equal(status, 400);
    assert.ok(data.error.includes('Unknown service'));
    assert.ok(data.error.includes('review-server'));
  });

  it('returns 404 when feature disabled', async () => {
    const result = createTestServer({ features: {} });
    const server2 = result.server;
    await new Promise(resolve => server2.listen(0, resolve));
    const port2 = server2.address().port;

    const { status } = await fetchJSON(port2, '/api/services/anything/restart', { method: 'POST' });
    assert.equal(status, 404);

    server2.close();
  });
});

// --- Claude status route ---

describe('GET /api/claude/status', () => {
  it('returns a response with loggedIn field', async () => {
    const result = createTestServer();
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/claude/status');
    assert.equal(status, 200);
    assert.equal(typeof data.loggedIn, 'boolean');

    server.close();
  });
});
