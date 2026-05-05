const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const { createServer } = require('../lib/server');

function makeAgentDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rated-items-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  return dir;
}

function createTestSvr(agentDir) {
  const config = {
    name: 'Test',
    port: 0,
    agentDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-ri-lock',
    _serverStartTime: Date.now(),
    features: { library: { dataDir: 'content/items' } },
  };
  const routes = {};
  require('../lib/routes/rated-items').register(routes, config);
  return createServer(config, { routes, getHTML: () => '<html>test</html>' });
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

async function startServer(agentDir) {
  const server = createTestSvr(agentDir);
  await new Promise(r => server.listen(0, r));
  return { server, port: server.address().port };
}

describe('GET /api/rated-items', () => {
  it('returns empty list when no items', async () => {
    const dir = makeAgentDir();
    const { server, port } = await startServer(dir);
    const { status, data } = await fetchJSON(port, '/api/rated-items');
    assert.equal(status, 200);
    assert.deepEqual(data, []);
    server.close();
  });

  it('filters by category and sorts newest first', async () => {
    const dir = makeAgentDir();
    fs.writeFileSync(path.join(dir, 'memory', 'rated-items.yaml'), yaml.dump({
      items: [
        { id: 'a', category: 'movies', title: 'A', rating: 'up', created_at: '2026-01-01T00:00:00Z' },
        { id: 'b', category: 'comics', title: 'B', rating: 'up', created_at: '2026-01-02T00:00:00Z' },
        { id: 'c', category: 'movies', title: 'C', rating: 'down', created_at: '2026-01-03T00:00:00Z' },
      ],
    }));
    const { server, port } = await startServer(dir);
    const { data } = await fetchJSON(port, '/api/rated-items?category=movies');
    assert.equal(data.length, 2);
    assert.equal(data[0].id, 'c');
    assert.equal(data[1].id, 'a');
    server.close();
  });
});

describe('POST /api/rated-items', () => {
  it('creates an item with generated id and timestamp', async () => {
    const dir = makeAgentDir();
    const { server, port } = await startServer(dir);
    const body = JSON.stringify({ category: 'movies', title: 'The Godfather', description: '1972, Pacino', rating: 'up' });
    const { status, data } = await fetchJSON(port, '/api/rated-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(status, 200);
    assert.ok(data.id.startsWith('rated-'));
    assert.equal(data.title, 'The Godfather');
    assert.equal(data.rating, 'up');
    assert.equal(data.processed_at, null);
    assert.ok(data.created_at);

    const persisted = yaml.load(fs.readFileSync(path.join(dir, 'memory', 'rated-items.yaml'), 'utf-8'));
    assert.equal(persisted.items.length, 1);
    server.close();
  });

  it('rejects missing title', async () => {
    const dir = makeAgentDir();
    const { server, port } = await startServer(dir);
    const body = JSON.stringify({ category: 'movies', rating: 'up' });
    const { status } = await fetchJSON(port, '/api/rated-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(status, 400);
    server.close();
  });

  it('rejects invalid rating', async () => {
    const dir = makeAgentDir();
    const { server, port } = await startServer(dir);
    const body = JSON.stringify({ category: 'movies', title: 'X', rating: 'maybe' });
    const { status } = await fetchJSON(port, '/api/rated-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(status, 400);
    server.close();
  });
});

describe('PUT /api/rated-items', () => {
  it('updates fields and resets processed_at', async () => {
    const dir = makeAgentDir();
    fs.writeFileSync(path.join(dir, 'memory', 'rated-items.yaml'), yaml.dump({
      items: [{ id: 'x', category: 'movies', title: 'Old', description: '', rating: 'up', created_at: '2026-01-01T00:00:00Z', processed_at: '2026-01-02T00:00:00Z' }],
    }));
    const { server, port } = await startServer(dir);
    const body = JSON.stringify({ id: 'x', title: 'New', rating: 'down' });
    const { status, data } = await fetchJSON(port, '/api/rated-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(status, 200);
    assert.equal(data.title, 'New');
    assert.equal(data.rating, 'down');
    assert.equal(data.processed_at, null);
    server.close();
  });

  it('returns 404 for unknown id', async () => {
    const dir = makeAgentDir();
    const { server, port } = await startServer(dir);
    const body = JSON.stringify({ id: 'nope', title: 'x' });
    const { status } = await fetchJSON(port, '/api/rated-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(status, 404);
    server.close();
  });
});

describe('DELETE /api/rated-items', () => {
  it('removes the item', async () => {
    const dir = makeAgentDir();
    fs.writeFileSync(path.join(dir, 'memory', 'rated-items.yaml'), yaml.dump({
      items: [{ id: 'x', category: 'movies', title: 'X', rating: 'up', created_at: '2026-01-01T00:00:00Z' }],
    }));
    const { server, port } = await startServer(dir);
    const body = JSON.stringify({ id: 'x' });
    const { status } = await fetchJSON(port, '/api/rated-items', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body });
    assert.equal(status, 200);
    const persisted = yaml.load(fs.readFileSync(path.join(dir, 'memory', 'rated-items.yaml'), 'utf-8'));
    assert.equal(persisted.items.length, 0);
    server.close();
  });
});
