const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');

function makeAgentDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  return dir;
}

function buildServer(agentDir, configOverrides = {}) {
  const config = {
    name: 'TestBot',
    port: 0,
    agentDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-ob-lock',
    _serverStartTime: Date.now(),
    features: { library: { dataDir: 'content/items' } },
    ...configOverrides,
  };
  const routes = {};
  require('../lib/routes/onboarding').register(routes, config);
  require('../lib/routes/preferences').register(routes, config);
  require('../lib/routes/rated-items').register(routes, config);
  return createServer(config, { routes, getHTML: () => '<html>spa</html>' });
}

function fetchRaw(port, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(options.body);
    }
    const opts = { hostname: '127.0.0.1', port, path: urlPath, method: options.method || 'GET', headers };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function start(agentDir, overrides) {
  const server = buildServer(agentDir, overrides);
  await new Promise(r => server.listen(0, r));
  return { server, port: server.address().port };
}

describe('GET /onboarding', () => {
  it('returns a standalone HTML page (not the SPA shell)', async () => {
    const dir = makeAgentDir();
    const { server, port } = await start(dir);
    const { status, headers, body } = await fetchRaw(port, '/onboarding');
    assert.equal(status, 200);
    assert.match(headers['content-type'] || '', /text\/html/);
    assert.match(body, /Add a category/);
    assert.match(body, /id="cat-name"/);
    assert.match(body, /id="cat-context"/);
    assert.match(body, /id="submit-btn"/);
    assert.doesNotMatch(body, /<html>spa<\/html>/);
    server.close();
  });

  it('embeds the agent name from config', async () => {
    const dir = makeAgentDir();
    const { server, port } = await start(dir, { name: 'ContentBot' });
    const { body } = await fetchRaw(port, '/onboarding');
    assert.match(body, /ContentBot/);
    server.close();
  });

  it('is gated on features.library', async () => {
    const dir = makeAgentDir();
    const { server, port } = await start(dir, { features: {} });
    const { status, body } = await fetchRaw(port, '/onboarding');
    // Without features.library, the route is not registered → SPA fallback returns the shell
    assert.equal(status, 200);
    assert.match(body, /<html>spa<\/html>/);
    server.close();
  });
});

describe('server.js non-/api dispatch', () => {
  it('still serves SPA shell for unknown non-/api paths', async () => {
    const dir = makeAgentDir();
    const { server, port } = await start(dir);
    const { status, body } = await fetchRaw(port, '/some-random-path');
    assert.equal(status, 200);
    assert.match(body, /<html>spa<\/html>/);
    server.close();
  });

  it('returns 404 JSON for unknown /api paths', async () => {
    const dir = makeAgentDir();
    const { server, port } = await start(dir);
    const { status, body } = await fetchRaw(port, '/api/nonexistent');
    assert.equal(status, 404);
    assert.match(body, /Not found/);
    server.close();
  });
});
