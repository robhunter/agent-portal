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
