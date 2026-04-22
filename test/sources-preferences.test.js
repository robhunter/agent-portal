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

// --- Preferences (per-category) ---

describe('GET /api/preferences', () => {
  it('returns per-category preference model', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/preferences');
    assert.equal(status, 200);
    assert.ok(data.books, 'should have books category');
    assert.ok(data.audiobooks, 'should have audiobooks category');
    assert.ok(Array.isArray(data.books.likes));
    assert.ok(Array.isArray(data.books.dislikes));
    assert.ok(data.books.likes.length >= 1);
    assert.equal(data.books.likes[0].source, 'agent');

    server.close();
  });

  it('returns empty model when file missing', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-empty-'));
    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/preferences');
    assert.equal(status, 200);
    assert.deepEqual(data, {});

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('POST /api/preferences', () => {
  it('adds entry to a category with source: user', async () => {
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
      body: JSON.stringify({ category: 'books', section: 'likes', text: 'Space opera with fleet battles' }),
    });
    assert.equal(status, 200);

    const { data } = await fetchJSON(port, '/api/preferences');
    const added = data.books.likes[data.books.likes.length - 1];
    assert.equal(added.text, 'Space opera with fleet battles');
    assert.equal(added.source, 'user');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates new category on first add', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-newcat-'));
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'memory', 'preferences.yaml'), path.join(memDir, 'preferences.yaml'));

    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'movies', section: 'likes', text: 'Harrison Ford' }),
    });
    assert.equal(status, 200);

    const { data } = await fetchJSON(port, '/api/preferences');
    assert.ok(data.movies, 'movies category should exist');
    assert.equal(data.movies.likes[0].text, 'Harrison Ford');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects missing category', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'likes', text: 'test' }),
    });
    assert.equal(status, 400);

    server.close();
  });

  it('rejects invalid section', async () => {
    const { server } = createTestSvr(fixturesDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'books', section: 'notes', text: 'test' }),
    });
    assert.equal(status, 400);

    server.close();
  });
});

describe('PUT /api/preferences', () => {
  it('updates entry by category + section + index', async () => {
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
      body: JSON.stringify({ category: 'books', section: 'likes', index: 0, text: 'Updated preference' }),
    });
    assert.equal(status, 200);

    const { data } = await fetchJSON(port, '/api/preferences');
    assert.equal(data.books.likes[0].text, 'Updated preference');

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
      body: JSON.stringify({ category: 'books', section: 'likes', index: 999, text: 'test' }),
    });
    assert.equal(status, 400);

    server.close();
  });
});

describe('DELETE /api/preferences', () => {
  it('removes entry by category + section + index', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-del-'));
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, 'memory', 'preferences.yaml'), path.join(memDir, 'preferences.yaml'));

    const { server } = createTestSvr(tmpDir);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { data: before } = await fetchJSON(port, '/api/preferences');
    const countBefore = before.books.dislikes.length;

    const { status } = await fetchJSON(port, '/api/preferences', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'books', section: 'dislikes', index: 0 }),
    });
    assert.equal(status, 200);

    const { data: after } = await fetchJSON(port, '/api/preferences');
    assert.equal(after.books.dislikes.length, countBefore - 1);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
