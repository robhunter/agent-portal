const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');
const { buildHTML } = require('../lib/ui');

// Full integration test — boots a portal from a complete config
// and validates all routes, the SPA HTML, and end-to-end journal flow

function bootPortal(configOverrides = {}) {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const config = {
    name: 'IntegrationTest',
    port: 0,
    agentDir: fixturesDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-portal-integration-lock',
    _serverStartTime: Date.now(),
    authors: {
      rob: { color: '#1565c0', bg: '#e3f2fd' },
      coder: { color: '#4527a0', bg: '#ede7f6' },
    },
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

  const getHTML = () => buildHTML(config);

  return { server: createServer(config, { routes, getHTML }), config };
}

async function fetchJSON(port, urlPath, options = {}) {
  const res = await fetch(`http://localhost:${port}${urlPath}`, options);
  const data = await res.json();
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
}

async function fetchHTML(port, urlPath) {
  const res = await fetch(`http://localhost:${port}${urlPath}`);
  const text = await res.text();
  return { status: res.status, text, contentType: res.headers.get('content-type') };
}

describe('Full portal integration', () => {
  let server, port;

  before(async () => {
    const result = bootPortal();
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  // --- SPA HTML ---
  it('serves SPA HTML at /', async () => {
    const { status, text, contentType } = await fetchHTML(port, '/');
    assert.equal(status, 200);
    assert.ok(contentType.includes('text/html'));
    assert.ok(text.includes('<title>IntegrationTest — Agent Portal</title>'));
    assert.ok(text.includes('marked.min.js'));
  });

  it('serves SPA HTML for any non-API path', async () => {
    const { status, text } = await fetchHTML(port, '/some/random/path');
    assert.equal(status, 200);
    assert.ok(text.includes('IntegrationTest'));
  });

  // --- API routes ---
  it('GET /api/status returns complete status', async () => {
    const { status, data } = await fetchJSON(port, '/api/status');
    assert.equal(status, 200);
    assert.ok(data.services);
    assert.ok(data.services['portal-server'].alive);
    assert.ok(typeof data.services['portal-server'].uptime === 'number');
    assert.ok(data.git);
    assert.ok(data.serverTime);
    assert.ok('cycleRunning' in data);
  });

  it('GET /api/next-run returns cron info', async () => {
    const { status, data } = await fetchJSON(port, '/api/next-run');
    assert.equal(status, 200);
    assert.ok('installed' in data);
  });

  it('GET /api/today returns today.md', async () => {
    const { status, data } = await fetchJSON(port, '/api/today');
    assert.equal(status, 200);
    assert.ok(data.content);
  });

  it('GET /api/journal returns entries', async () => {
    const { status, data } = await fetchJSON(port, '/api/journal');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.entries));
    assert.ok(data.entries.length > 0);
    // Verify entry structure
    const entry = data.entries[0];
    assert.ok(entry.ts);
    assert.ok(entry.author);
    assert.ok(entry.tag);
    assert.ok(entry.content);
  });

  it('GET /api/events returns events', async () => {
    const { status, data } = await fetchJSON(port, '/api/events');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
  });

  it('GET /api/wins returns array', async () => {
    const { status, data } = await fetchJSON(port, '/api/wins');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
  });

  it('GET /api/github/issues returns empty (no repos)', async () => {
    const { status, data } = await fetchJSON(port, '/api/github/issues');
    assert.equal(status, 200);
    assert.deepEqual(data.items, []);
  });

  it('returns 404 for unknown API routes', async () => {
    const { status, data } = await fetchJSON(port, '/api/nonexistent');
    assert.equal(status, 404);
    assert.ok(data.error);
  });

  // --- JSON content type ---
  it('returns application/json for API routes', async () => {
    const { headers } = await fetchJSON(port, '/api/status');
    assert.ok(headers['content-type'].includes('application/json'));
  });
});

describe('Journal write + read integration', () => {
  let server, port, tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-int-journal-'));
    fs.mkdirSync(path.join(tmpDir, 'journals'));
    fs.mkdirSync(path.join(tmpDir, 'logs'));

    const result = bootPortal({ agentDir: tmpDir });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('full cycle: write, read, verify', async () => {
    // Write
    const writeRes = await fetchJSON(port, '/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Integration test entry', tag: 'observation' }),
    });
    assert.equal(writeRes.status, 200);
    assert.equal(writeRes.data.ok, true);
    assert.equal(writeRes.data.tag, 'observation');

    // Read back
    const readRes = await fetchJSON(port, '/api/journal');
    assert.equal(readRes.status, 200);
    assert.ok(readRes.data.entries.length >= 1);
    const lastEntry = readRes.data.entries[readRes.data.entries.length - 1];
    assert.equal(lastEntry.tag, 'observation');
    assert.ok(lastEntry.content.includes('Integration test entry'));
    assert.equal(lastEntry.author, 'rob');
  });
});

describe('Config variations', () => {
  it('boots with GitHub repos configured', async () => {
    const result = bootPortal({
      features: { github: { repos: ['robhunter/agent-portal'] } },
    });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    // HTML should include GitHub tab
    const htmlRes = await fetchHTML(port, '/');
    assert.ok(htmlRes.text.includes('data-tab="github"'));
    assert.ok(htmlRes.text.includes('"hasGitHub":true'));

    server.close();
  });

  it('boots with custom tabs', async () => {
    const result = bootPortal({
      features: { tabs: ['status', 'journal'] },
    });
    const server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const htmlRes = await fetchHTML(port, '/');
    // Status should be first/active
    assert.ok(htmlRes.text.includes('class="tab active" data-tab="status"'));

    server.close();
  });
});

// --- PM-specific integration tests ---

describe('PM portal integration', () => {
  let server, port;

  before(async () => {
    const result = bootPortal({
      name: 'PM',
      authors: {
        rob: { color: '#1565c0', bg: '#e3f2fd' },
        pm: { color: '#00695c', bg: '#e0f2f1' },
      },
      features: {
        github: { repos: ['robhunter/agentdeals'] },
        tabs: ['journal', 'github', 'roadmap', 'health', 'requests', 'status'],
        cronToggle: true,
        cycleButtons: true,
        statusDot: true,
        roadmap: true,
        health: true,
        requests: true,
      },
    });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('HTML includes all 6 PM tabs', async () => {
    const { text } = await fetchHTML(port, '/');
    assert.ok(text.includes('data-tab="journal"'));
    assert.ok(text.includes('data-tab="github"'));
    assert.ok(text.includes('data-tab="roadmap"'));
    assert.ok(text.includes('data-tab="health"'));
    assert.ok(text.includes('data-tab="requests"'));
    assert.ok(text.includes('data-tab="status"'));
  });

  it('HTML includes PM author badge CSS', async () => {
    const { text } = await fetchHTML(port, '/');
    assert.ok(text.includes('.author-badge.pm'));
    assert.ok(text.includes('#00695c'));
  });

  it('HTML includes all tab loader functions', async () => {
    const { text } = await fetchHTML(port, '/');
    assert.ok(text.includes('function loadRoadmap'));
    assert.ok(text.includes('function loadHealth'));
    assert.ok(text.includes('function loadRequests'));
    assert.ok(text.includes('function loadGitHub'));
  });

  it('GET /api/roadmap returns content', async () => {
    const { status, data } = await fetchJSON(port, '/api/roadmap');
    assert.equal(status, 200);
    assert.ok(data.content);
  });

  it('GET /api/health returns entries', async () => {
    const { status, data } = await fetchJSON(port, '/api/health');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
  });

  it('GET /api/requests returns items', async () => {
    const { status, data } = await fetchJSON(port, '/api/requests');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.length > 0);
  });

  it('all core routes still work', async () => {
    const statusRes = await fetchJSON(port, '/api/status');
    assert.equal(statusRes.status, 200);
    const journalRes = await fetchJSON(port, '/api/journal');
    assert.equal(journalRes.status, 200);
    const eventsRes = await fetchJSON(port, '/api/events');
    assert.equal(eventsRes.status, 200);
  });
});

describe('Coder config regression check', () => {
  let server, port;

  before(async () => {
    // Boot with Coder-like config — no PM features
    const result = bootPortal({
      name: 'Coder',
      features: {
        github: { repos: ['robhunter/agentdeals'] },
        tabs: ['journal', 'github', 'status'],
      },
    });
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('HTML has only 3 tabs (no PM tabs)', async () => {
    const { text } = await fetchHTML(port, '/');
    assert.ok(text.includes('data-tab="journal"'));
    assert.ok(text.includes('data-tab="github"'));
    assert.ok(text.includes('data-tab="status"'));
    assert.ok(!text.includes('data-tab="roadmap"'));
    assert.ok(!text.includes('data-tab="health"'));
    assert.ok(!text.includes('data-tab="requests"'));
  });

  it('PM routes return 404', async () => {
    const roadmapRes = await fetchJSON(port, '/api/roadmap');
    assert.equal(roadmapRes.status, 404);
    const healthRes = await fetchJSON(port, '/api/health');
    assert.equal(healthRes.status, 404);
    const requestsRes = await fetchJSON(port, '/api/requests');
    assert.equal(requestsRes.status, 404);
  });

  it('core routes still work', async () => {
    const statusRes = await fetchJSON(port, '/api/status');
    assert.equal(statusRes.status, 200);
    const journalRes = await fetchJSON(port, '/api/journal');
    assert.equal(journalRes.status, 200);
  });
});
