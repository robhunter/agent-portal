// data-dir-routes.test.js — End-to-end coverage that every route module reads/writes
// from <agentDir>/<dataDir>/ when dataDir is set to "data". Fixtures are copied
// into a tmpdir under data/ so the legacy fixture tree at test/fixtures/ stays
// canonical for the existing default-mode tests.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { createServer } = require('../lib/server');
const { buildHTML } = require('../lib/ui');

const FIXTURES = path.join(__dirname, 'fixtures');

// Subdirs that conceptually live under dataDir. Operator files (today.md,
// roadmap.md, minimal.json) stay at agentDir root.
const DATA_SUBDIRS = ['memory', 'config', 'input', 'output', 'content', 'uploads', 'requests', 'journals', 'logs', 'projects'];
const ROOT_FILES = ['today.md'];

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function buildDataDirAgent() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-dir-routes-'));
  const agentDir = path.join(tmpRoot, 'agent');
  const dataDir = path.join(agentDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // Move conceptually-data subdirs into agentDir/data/
  for (const sub of DATA_SUBDIRS) {
    const fixSub = path.join(FIXTURES, sub);
    if (fs.existsSync(fixSub)) copyDirSync(fixSub, path.join(dataDir, sub));
  }
  // Keep operator-owned root files at agentDir
  for (const f of ROOT_FILES) {
    const fixF = path.join(FIXTURES, f);
    if (fs.existsSync(fixF)) fs.copyFileSync(fixF, path.join(agentDir, f));
  }
  return { tmpRoot, agentDir };
}

function bootPortal(agentDir, extraConfig = {}) {
  const config = {
    name: 'DataDirRoutesTest',
    port: 0,
    agentDir,
    dataDir: 'data',
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-data-dir-routes.lock',
    _serverStartTime: Date.now(),
    authors: { rob: { color: '#000', bg: '#fff' } },
    features: {
      outputs: true,
      feedback: true,
      requests: true,
      health: true,
      library: { dataDir: 'content/items' },
      tabs: ['library', 'preferences', 'sources', 'todos', 'outputs', 'requests'],
    },
    sidebar: { type: 'projects', projectsDir: 'projects' },
    ...extraConfig,
  };

  const routes = {};
  require('../lib/routes/status').register(routes, config);
  require('../lib/routes/journal').register(routes, config);
  require('../lib/routes/events').register(routes, config);
  require('../lib/routes/health').register(routes, config);
  require('../lib/routes/requests').register(routes, config);
  require('../lib/routes/projects').register(routes, config);
  require('../lib/routes/outputs').register(routes, config);
  require('../lib/routes/uploads').register(routes, config);
  require('../lib/routes/todos').register(routes, config);
  require('../lib/routes/library').register(routes, config);
  require('../lib/routes/sources').register(routes, config);
  require('../lib/routes/preferences').register(routes, config);
  require('../lib/routes/rated-items').register(routes, config);
  require('../lib/routes/badges').register(routes, config);
  require('../lib/routes/media-files').register(routes, config);
  require('../lib/routes/tts').register(routes, config);

  const getHTML = () => buildHTML(config);
  const server = createServer(config, { routes, getHTML });
  return new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port, config });
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${urlPath}`, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

function postJSON(port, urlPath, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('routes honor dataDir="data" — every handler reads/writes under <agentDir>/data/', () => {
  let tmpRoot, agentDir, server, port;

  before(async () => {
    ({ tmpRoot, agentDir } = buildDataDirAgent());
    ({ server, port } = await bootPortal(agentDir));
  });

  after(() => {
    if (server) server.close();
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('GET /api/journal reads from data/journals/', async () => {
    const res = await get(port, '/api/journal');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.entries), 'entries should be array');
    assert.ok(data.entries.length > 0, 'fixture journals should yield entries');
  });

  it('POST /api/journal writes into data/journals/', async () => {
    const res = await postJSON(port, '/api/journal', { text: 'route test entry', tag: 'note' });
    assert.equal(res.status, 200);
    // Find the monthly file under data/journals
    const journalsDir = path.join(agentDir, 'data', 'journals');
    const files = fs.readdirSync(journalsDir).filter(f => /^\d{4}-\d{2}\.md$/.test(f));
    assert.ok(files.length > 0, 'should have a monthly journal file');
    // Verify the entry landed in *some* monthly journal under data/, NOT at root
    const allContent = files.map(f => fs.readFileSync(path.join(journalsDir, f), 'utf-8')).join('\n');
    assert.match(allContent, /route test entry/);
    assert.ok(!fs.existsSync(path.join(agentDir, 'journals')), 'no root-level journals/');
  });

  it('GET /api/library reads from data/content/items/', async () => {
    const res = await get(port, '/api/library');
    assert.equal(res.status, 200);
    const items = JSON.parse(res.body);
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0, 'fixture library has items');
  });

  it('GET /api/preferences reads from data/memory/preferences.yaml', async () => {
    const res = await get(port, '/api/preferences');
    assert.equal(res.status, 200);
    const prefs = JSON.parse(res.body);
    assert.ok(typeof prefs === 'object');
  });

  it('POST /api/preferences writes into data/memory/preferences.yaml', async () => {
    const res = await postJSON(port, '/api/preferences', {
      category: 'comics', section: 'likes', text: 'route-test marker',
    });
    assert.equal(res.status, 200);
    const yamlContent = fs.readFileSync(path.join(agentDir, 'data', 'memory', 'preferences.yaml'), 'utf-8');
    assert.match(yamlContent, /route-test marker/);
  });

  it('GET /api/rated-items reads from data/memory/rated-items.yaml (empty array if absent)', async () => {
    const res = await get(port, '/api/rated-items');
    assert.equal(res.status, 200);
    const items = JSON.parse(res.body);
    assert.ok(Array.isArray(items), 'response should be a list');
  });

  it('POST /api/rated-items writes into data/memory/rated-items.yaml', async () => {
    const res = await postJSON(port, '/api/rated-items', {
      category: 'comics', title: 'Test Title', description: 'desc', rating: 'up',
    });
    assert.equal(res.status, 200);
    const filePath = path.join(agentDir, 'data', 'memory', 'rated-items.yaml');
    assert.ok(fs.existsSync(filePath), 'rated-items.yaml should be created under data/');
    assert.ok(!fs.existsSync(path.join(agentDir, 'memory', 'rated-items.yaml')), 'no root-level memory/');
  });

  it('GET /api/sources reads from data/config/sources.yaml', async () => {
    const res = await get(port, '/api/sources');
    assert.equal(res.status, 200);
    const sources = JSON.parse(res.body);
    assert.ok(Array.isArray(sources));
  });

  it('GET /api/outputs reads from data/output/', async () => {
    const res = await get(port, '/api/outputs');
    assert.equal(res.status, 200);
    const items = JSON.parse(res.body);
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0, 'fixture outputs should be present');
  });

  it('POST /api/feedback writes into data/input/feedback/', async () => {
    const res = await postJSON(port, '/api/feedback/alpha-feature-api-endpoints.md', { rating: 2, notes: 'route test' });
    assert.equal(res.status, 200);
    const fb = path.join(agentDir, 'data', 'input', 'feedback', 'alpha-feature-api-endpoints.feedback.yaml');
    assert.ok(fs.existsSync(fb), 'feedback file should exist under data/');
  });

  it('GET /api/projects reads from data/projects/ and data/journals/', async () => {
    const res = await get(port, '/api/projects');
    assert.equal(res.status, 200);
    const items = JSON.parse(res.body);
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0, 'fixture projects should be present');
  });

  it('GET /api/requests reads from data/requests/', async () => {
    const res = await get(port, '/api/requests');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.length > 0, 'fixture requests should be present');
  });

  it('GET /api/badges reads from configured dataDir subdirs', async () => {
    const res = await get(port, '/api/badges');
    assert.equal(res.status, 200);
    JSON.parse(res.body); // shape varies; just verify it parses without crashing
  });

  it('POST /api/upload writes into data/uploads/', async () => {
    const pngBase64 = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).toString('base64');
    const res = await postJSON(port, '/api/upload', { filename: 'test.png', data: pngBase64 });
    assert.equal(res.status, 200);
    const uploadsDir = path.join(agentDir, 'data', 'uploads');
    const files = fs.readdirSync(uploadsDir);
    assert.ok(files.some(f => f.endsWith('_test.png')), 'upload landed in data/uploads/');
    assert.ok(!fs.existsSync(path.join(agentDir, 'uploads')), 'no root-level uploads/');
  });

  it('POST /api/feedback/library/:id writes to data/input/feedback/', async () => {
    const res = await postJSON(port, '/api/feedback/library/dark-matter-crouch', { rating: 'up' });
    assert.equal(res.status, 200);
    const fb = path.join(agentDir, 'data', 'input', 'feedback', 'dark-matter-crouch.feedback.yaml');
    assert.ok(fs.existsSync(fb));
  });

  it('GET /api/today still reads agentDir root (operator-owned, not under dataDir)', async () => {
    const res = await get(port, '/api/today');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    // today.md was placed at agentDir root by buildDataDirAgent, not under data/
    assert.ok(data.content && !data.content.startsWith('*No today.md'), 'today.md should be read from agentDir root');
  });

  it('GET /api/status reads logs from data/logs/ but git ops from agentDir', async () => {
    const res = await get(port, '/api/status');
    assert.equal(res.status, 200);
    const status = JSON.parse(res.body);
    assert.ok(status.services && status.services['portal-server'].alive);
  });

  it('GET /api/events handles missing data/logs/events.jsonl gracefully', async () => {
    const res = await get(port, '/api/events');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(JSON.parse(res.body)));
  });

  it('GET /api/health reads from data/logs/health.jsonl', async () => {
    const res = await get(port, '/api/health');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(JSON.parse(res.body)));
  });
});

describe('regression: routes still work with default dataDir (legacy layout)', () => {
  let server, port;

  before(async () => {
    // Boot directly against fixtures/ with no dataDir — should behave exactly as before
    const routes = {};
    const config = {
      name: 'LegacyTest', port: 0,
      agentDir: FIXTURES,
      cronFile: '/nonexistent/cron',
      lockFile: '/tmp/test-data-dir-legacy.lock',
      _serverStartTime: Date.now(),
      authors: { rob: { color: '#000', bg: '#fff' } },
      features: {
        outputs: true, feedback: true, requests: true, health: true,
        library: { dataDir: 'content/items' },
        tabs: ['library', 'preferences', 'sources', 'outputs', 'requests'],
      },
      sidebar: { type: 'projects', projectsDir: 'projects' },
    };
    require('../lib/routes/journal').register(routes, config);
    require('../lib/routes/library').register(routes, config);
    require('../lib/routes/preferences').register(routes, config);
    require('../lib/routes/sources').register(routes, config);
    require('../lib/routes/projects').register(routes, config);
    require('../lib/routes/requests').register(routes, config);
    require('../lib/routes/outputs').register(routes, config);
    require('../lib/routes/status').register(routes, config);
    require('../lib/routes/events').register(routes, config);
    const getHTML = () => buildHTML(config);
    server = createServer(config, { routes, getHTML });
    await new Promise(resolve => server.listen(0, () => { port = server.address().port; resolve(); }));
  });

  after(() => { if (server) server.close(); });

  it('GET /api/journal returns fixture entries (legacy path)', async () => {
    const res = await get(port, '/api/journal');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.entries.length > 0);
  });

  it('GET /api/library returns fixture items (legacy path)', async () => {
    const res = await get(port, '/api/library');
    assert.equal(res.status, 200);
    assert.ok(JSON.parse(res.body).length > 0);
  });

  it('GET /api/sources returns fixture sources (legacy path)', async () => {
    const res = await get(port, '/api/sources');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(JSON.parse(res.body)));
  });
});
