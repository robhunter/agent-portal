const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');

const fixturesDir = path.join(__dirname, 'fixtures');

function createLibraryServer(configOverrides = {}) {
  const config = {
    name: 'ContentBot Test',
    port: 0,
    agentDir: fixturesDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-library-lock-nonexistent',
    _serverStartTime: Date.now(),
    features: {
      library: { dataDir: 'content/items' },
    },
    ...configOverrides,
  };

  const routes = {};
  require('../lib/routes/library').register(routes, config);
  require('../lib/routes/outputs').register(routes, config);
  return { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }), config };
}

function fetchJSON(port, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port, path: urlPath, method: options.method || 'GET', ...options };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('GET /api/library', () => {
  it('returns content items with feedback status', async () => {
    const { server } = createLibraryServer();
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/library');
    assert.equal(status, 200);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 10, `Expected at least 10 items, got ${data.length}`);

    // Items should be sorted by discovered desc
    for (let i = 1; i < data.length; i++) {
      if (data[i - 1].discovered && data[i].discovered) {
        assert.ok(new Date(data[i - 1].discovered) >= new Date(data[i].discovered),
          `Items not sorted by discovered desc at index ${i}`);
      }
    }

    // Check a known item with feedback
    const darkMatter = data.find(d => d.id === 'dark-matter-crouch');
    assert.ok(darkMatter, 'dark-matter-crouch should exist');
    assert.equal(darkMatter.category, 'books');
    assert.equal(darkMatter.rating, 'up');
    assert.equal(darkMatter.reviewed, true);

    // Check unreviewed item
    const challenger = data.find(d => d.id === 'challenger-higginbotham');
    assert.ok(challenger, 'challenger-higginbotham should exist');
    assert.equal(challenger.rating, null);
    assert.equal(challenger.reviewed, false);

    server.close();
  });

  it('returns 404 when library not configured', async () => {
    const config = {
      name: 'Test',
      port: 0,
      agentDir: fixturesDir,
      cronFile: '/nonexistent/cron',
      lockFile: '/tmp/test-nolibrary-lock',
      _serverStartTime: Date.now(),
      features: {},
    };
    const routes = {};
    require('../lib/routes/library').register(routes, config);
    const { server } = { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }) };
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/library');
    assert.equal(status, 404);

    server.close();
  });
});

describe('GET /api/library/:id', () => {
  it('returns full item detail with merged feedback', async () => {
    const { server } = createLibraryServer();
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/library/dark-matter-crouch');
    assert.equal(status, 200);
    assert.equal(data.title, 'Dark Matter');
    assert.equal(data.category, 'books');
    assert.ok(data.metadata);
    assert.equal(data.metadata.author, 'Blake Crouch');
    assert.ok(data.feedback, 'Should have merged feedback');
    assert.equal(data.feedback.rating, 'up');

    server.close();
  });

  it('merges feedback from processed/ subdirectory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-processed-'));
    const itemsDir = path.join(tmpDir, 'content', 'items');
    const processedDir = path.join(tmpDir, 'input', 'feedback', 'processed');
    fs.mkdirSync(itemsDir, { recursive: true });
    fs.mkdirSync(processedDir, { recursive: true });
    fs.writeFileSync(path.join(itemsDir, 'test-item.yaml'),
      'id: test-item\ntitle: Test Item\ncategory: comics\n');
    fs.writeFileSync(path.join(processedDir, 'test-item.feedback.yaml'),
      'rating: up\nnotes: Great stuff\n');

    const config = {
      name: 'Test', port: 0, agentDir: tmpDir,
      cronFile: '/nonexistent/cron', lockFile: '/tmp/test-processed-lock',
      _serverStartTime: Date.now(),
      features: { library: { dataDir: 'content/items' } },
    };
    const routes = {};
    require('../lib/routes/library').register(routes, config);
    const server = createServer(config, { routes, getHTML: () => '<html>test</html>' });
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    // List should show as rated
    const { data: list } = await fetchJSON(port, '/api/library');
    assert.equal(list[0].rating, 'up');
    assert.equal(list[0].reviewed, true);

    // Detail should merge feedback
    const { data: detail } = await fetchJSON(port, '/api/library/test-item');
    assert.ok(detail.feedback);
    assert.equal(detail.feedback.rating, 'up');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns item without feedback when none exists', async () => {
    const { server } = createLibraryServer();
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/library/challenger-higginbotham');
    assert.equal(status, 200);
    assert.equal(data.title, 'Challenger');
    assert.equal(data.feedback, undefined);

    server.close();
  });

  it('returns 404 for nonexistent item', async () => {
    const { server } = createLibraryServer();
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/library/nonexistent-item');
    assert.equal(status, 404);

    server.close();
  });

  it('rejects path traversal', async () => {
    const { server } = createLibraryServer();
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/library/..%2F..%2Fetc%2Fpasswd');
    assert.equal(status, 400);

    server.close();
  });
});

describe('POST /api/feedback/library/:id', () => {
  it('creates feedback file with thumbs up', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-test-'));
    // Copy an item fixture
    const itemsDir = path.join(tmpDir, 'content', 'items');
    fs.mkdirSync(itemsDir, { recursive: true });
    fs.copyFileSync(
      path.join(fixturesDir, 'content', 'items', 'challenger-higginbotham.yaml'),
      path.join(itemsDir, 'challenger-higginbotham.yaml')
    );

    const config = {
      name: 'Test',
      port: 0,
      agentDir: tmpDir,
      cronFile: '/nonexistent/cron',
      lockFile: '/tmp/test-feedback-lock',
      _serverStartTime: Date.now(),
      features: { library: { dataDir: 'content/items' } },
    };
    const routes = {};
    require('../lib/routes/library').register(routes, config);
    const server = createServer(config, { routes, getHTML: () => '<html>test</html>' });
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/feedback/library/challenger-higginbotham', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'up', notes: 'Loved the engineering detail' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);

    // Verify file was written
    const fbPath = path.join(tmpDir, 'input', 'feedback', 'challenger-higginbotham.feedback.yaml');
    assert.ok(fs.existsSync(fbPath), 'Feedback file should exist');
    const fbContent = fs.readFileSync(fbPath, 'utf-8');
    assert.ok(fbContent.includes('rating: up'));
    assert.ok(fbContent.includes('Loved the engineering detail'));

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects invalid rating', async () => {
    const { server } = createLibraryServer();
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/feedback/library/some-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'maybe' }),
    });
    assert.equal(status, 400);

    server.close();
  });

  it('rejects empty feedback', async () => {
    const { server } = createLibraryServer();
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/feedback/library/some-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(status, 400);

    server.close();
  });
});

describe('POST /api/feedback/library/:id/report', () => {
  function buildAgent() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-report-'));
    const itemsDir = path.join(tmpDir, 'content', 'items');
    fs.mkdirSync(itemsDir, { recursive: true });
    const item = {
      id: 'heat-1995',
      title: 'Heat',
      category: 'movies',
      source: 'hulu',
      source_url: 'https://www.hulu.com/movie/heat',
      status: 'linked',
    };
    fs.writeFileSync(
      path.join(itemsDir, 'heat-1995.yaml'),
      require('js-yaml').dump(item, { lineWidth: -1 })
    );
    return tmpDir;
  }

  it('moves the item to content/reported/ with a _report block', async () => {
    const tmpDir = buildAgent();
    const { server } = createLibraryServer({ agentDir: tmpDir });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/feedback/library/heat-1995/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Spanish edition, not English', category: 'language' }),
    });
    assert.equal(status, 200);
    assert.equal(data.ok, true);

    // Item gone from items/, present in reported/ with the _report block
    assert.ok(!fs.existsSync(path.join(tmpDir, 'content', 'items', 'heat-1995.yaml')), 'item should be gone from items/');
    const reportedPath = path.join(tmpDir, 'content', 'reported', 'heat-1995.yaml');
    assert.ok(fs.existsSync(reportedPath), 'item should be in reported/');
    const reportedYaml = require('js-yaml').load(fs.readFileSync(reportedPath, 'utf-8'));
    assert.equal(reportedYaml.id, 'heat-1995');
    assert.equal(reportedYaml._report.category, 'language');
    assert.match(reportedYaml._report.reason, /Spanish edition/);
    assert.ok(reportedYaml._report.reported_at);

    // Feedback file dropped for the agent
    const fbPath = path.join(tmpDir, 'input', 'feedback', 'heat-1995.report.yaml');
    assert.ok(fs.existsSync(fbPath), 'feedback file should be created');
    const fbYaml = require('js-yaml').load(fs.readFileSync(fbPath, 'utf-8'));
    assert.equal(fbYaml.item, 'heat-1995');
    assert.equal(fbYaml.report.category, 'language');
    assert.match(fbYaml.report.reason, /Spanish edition/);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('defaults category to "other" when omitted', async () => {
    const tmpDir = buildAgent();
    const { server } = createLibraryServer({ agentDir: tmpDir });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/feedback/library/heat-1995/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'just bad' }),
    });
    assert.equal(status, 200);

    const reportedYaml = require('js-yaml').load(
      fs.readFileSync(path.join(tmpDir, 'content', 'reported', 'heat-1995.yaml'), 'utf-8')
    );
    assert.equal(reportedYaml._report.category, 'other');

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects missing reason', async () => {
    const tmpDir = buildAgent();
    const { server } = createLibraryServer({ agentDir: tmpDir });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/feedback/library/heat-1995/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'language' }),
    });
    assert.equal(status, 400);
    assert.match(data.error, /reason is required/);

    // Item should still be in items/
    assert.ok(fs.existsSync(path.join(tmpDir, 'content', 'items', 'heat-1995.yaml')));

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects whitespace-only reason', async () => {
    const tmpDir = buildAgent();
    const { server } = createLibraryServer({ agentDir: tmpDir });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/feedback/library/heat-1995/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '   \n  ' }),
    });
    assert.equal(status, 400);
    assert.match(data.error, /reason is required/);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects invalid category', async () => {
    const tmpDir = buildAgent();
    const { server } = createLibraryServer({ agentDir: tmpDir });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/feedback/library/heat-1995/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'x', category: 'bogus' }),
    });
    assert.equal(status, 400);
    assert.match(data.error, /category must be one of/);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns 404 for an item not in the library', async () => {
    const tmpDir = buildAgent();
    const { server } = createLibraryServer({ agentDir: tmpDir });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status, data } = await fetchJSON(port, '/api/feedback/library/no-such-item/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'x', category: 'other' }),
    });
    assert.equal(status, 404);
    assert.match(data.error, /not found/i);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('rejects invalid id with path traversal', async () => {
    const tmpDir = buildAgent();
    const { server } = createLibraryServer({ agentDir: tmpDir });
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const { status } = await fetchJSON(port, '/api/feedback/library/' + encodeURIComponent('../../etc/passwd') + '/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'x' }),
    });
    assert.equal(status, 400);

    server.close();
    fs.rmSync(tmpDir, { recursive: true });
  });
});
