const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');

const fixturesDir = path.join(__dirname, 'fixtures');

function createTestSvr(agentDir, configOverrides = {}) {
  const config = {
    name: 'Test',
    port: 0,
    agentDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-sp-lock',
    _serverStartTime: Date.now(),
    features: { library: { dataDir: 'content/items' } },
    ...configOverrides,
  };
  const routes = {};
  require('../lib/routes/sources').register(routes, config);
  require('../lib/routes/preferences').register(routes, config);
  return { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }), config };
}

function fetchJSON(port, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const opts = { hostname: '127.0.0.1', port, path: urlPath, method: options.method || 'GET', headers };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// --- Sources ---

describe('GET /api/sources', () => {
  it('returns sources from config/sources.yaml', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/sources');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 5);
    const archiveOrg = data.find(s => s.id === 'archive-org');
    assert.ok(archiveOrg);
    assert.equal(archiveOrg.status, 'approved');
    assert.equal(archiveOrg.type, 'downloadable');

    server.close();
  });

  it('includes pending sources', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { data } = await fetchJSON(port, '/api/sources');
    const pending = data.find(s => s.id === 'shady-torrents');
    assert.ok(pending);
    assert.equal(pending.status, 'pending');

    server.close();
  });
});

describe('POST /api/sources/:id/approve', () => {
  it('sets source status to approved', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-test-'));
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'config', 'sources.yaml'), path.join(configDir, 'sources.yaml'));

    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/sources/shady-torrents/approve', { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.status, 'approved');

    // Verify written to file
    const { data: sources } = await fetchJSON(port, '/api/sources');
    const updated = sources.find(s => s.id === 'shady-torrents');
    assert.equal(updated.status, 'approved');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns 404 for unknown source', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/sources/nonexistent/approve', { method: 'POST' });
    assert.equal(status, 404);

    server.close();
  });
});

describe('POST /api/sources/:id/deny', () => {
  it('sets source status to denied', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-deny-'));
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'config', 'sources.yaml'), path.join(configDir, 'sources.yaml'));

    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/sources/shady-torrents/deny', { method: 'POST' });
    assert.equal(status, 200);
    assert.equal(data.status, 'denied');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// --- Preferences ---

describe('GET /api/preferences', () => {
  it('returns preference model from memory/preferences.yaml', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/preferences');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data.likes));
    assert.ok(Array.isArray(data.dislikes));
    assert.ok(Array.isArray(data.notes));
    assert.ok(data.likes.length >= 3);
    assert.equal(data.likes[0].source, 'agent');

    server.close();
  });

  it('returns empty model when file missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-empty-'));
    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/preferences');
    assert.equal(status, 200);
    assert.deepEqual(data.likes, []);
    assert.deepEqual(data.dislikes, []);
    assert.deepEqual(data.notes, []);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('POST /api/preferences', () => {
  it('adds a new like entry with source: user', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-add-'));
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'memory', 'preferences.yaml'), path.join(memDir, 'preferences.yaml'));

    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'likes', text: 'Space opera with big fleet battles' }),
    });
    assert.equal(status, 200);

    // Verify it was added
    const { data } = await fetchJSON(port, '/api/preferences');
    const added = data.likes[data.likes.length - 1];
    assert.equal(added.text, 'Space opera with big fleet battles');
    assert.equal(added.source, 'user');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects invalid section', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'invalid', text: 'test' }),
    });
    assert.equal(status, 400);

    server.close();
  });
});

describe('PUT /api/preferences', () => {
  it('updates an entry by index', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-put-'));
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'memory', 'preferences.yaml'), path.join(memDir, 'preferences.yaml'));

    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'likes', index: 0, text: 'Updated preference text' }),
    });
    assert.equal(status, 200);

    const { data } = await fetchJSON(port, '/api/preferences');
    assert.equal(data.likes[0].text, 'Updated preference text');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects invalid index', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'likes', index: 999, text: 'test' }),
    });
    assert.equal(status, 400);

    server.close();
  });
});

describe('DELETE /api/preferences', () => {
  it('removes an entry by index', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-del-'));
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'memory', 'preferences.yaml'), path.join(memDir, 'preferences.yaml'));

    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    // Get initial count
    const { data: before } = await fetchJSON(port, '/api/preferences');
    const countBefore = before.dislikes.length;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'dislikes', index: 0 }),
    });
    assert.equal(status, 200);

    const { data: after } = await fetchJSON(port, '/api/preferences');
    assert.equal(after.dislikes.length, countBefore - 1);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
