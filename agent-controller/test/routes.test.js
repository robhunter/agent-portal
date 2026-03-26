const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { execFileSync } = require('child_process');
const { createRouter } = require('../lib/routes');

// Generate a test keypair
const keypair = JSON.parse(execFileSync('vestauth', ['primitives', 'keypair', '--pp'], { encoding: 'utf8' }));
const testUid = 'agent-routetest001';

function makeTestConfig() {
  return {
    listen: { host: '127.0.0.1', port: 0 },
    agentsRoot: '/tmp/agents',
    frameworkDir: '/tmp/framework',
    callers: {
      [testUid]: { callerId: 'agentbox', uid: testUid, publicJwk: keypair.public_jwk },
    },
    agents: {
      'test-agent': {
        name: 'test-agent',
        dir: '/tmp/agents/test-agent',
        controllable: true,
        deployment: 'sandcat',
        permissions: {
          agentbox: new Set(['status', 'restart', 'logs']),
        },
      },
      'locked-agent': {
        name: 'locked-agent',
        dir: '/tmp/agents/locked-agent',
        controllable: false,
        deployment: 'sandcat',
        permissions: {},
      },
    },
  };
}

function signHeaders(method, url) {
  const out = execFileSync('vestauth', [
    'primitives', 'headers', method, url,
    '--uid', testUid,
    '--private-jwk', JSON.stringify(keypair.private_jwk),
  ], { encoding: 'utf8' });
  const raw = JSON.parse(out);
  const headers = {};
  for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = v;
  return headers;
}

function request(server, method, path, signedHeaders) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}${path}`;

    // If we need signed headers, generate them for the full URL
    let headers = signedHeaders;
    if (signedHeaders === 'sign') {
      headers = signHeaders(method, url);
    }

    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: headers || {},
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('routes', () => {
  let server;

  before((_, done) => {
    const config = makeTestConfig();
    const handleRequest = createRouter(config);
    server = http.createServer((req, res) => {
      handleRequest(req, res).catch(() => {
        if (!res.writableEnded) { res.writeHead(500); res.end('{}'); }
      });
    });
    server.listen(0, '127.0.0.1', done);
  });

  after((_, done) => {
    server.close(done);
  });

  it('returns 401 for unauthenticated request to /agents', async () => {
    const res = await request(server, 'GET', '/agents');
    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
  });

  it('returns 200 with agent list for authenticated request to /agents', async () => {
    const res = await request(server, 'GET', '/agents', 'sign');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(Array.isArray(res.body.agents));
    assert.equal(res.body.agents.length, 1);
    assert.equal(res.body.agents[0].name, 'test-agent');
  });

  it('hides non-controllable agents from /agents list', async () => {
    const res = await request(server, 'GET', '/agents', 'sign');
    const names = res.body.agents.map(a => a.name);
    assert.ok(!names.includes('locked-agent'));
  });

  it('returns 403 for status of non-controllable agent', async () => {
    const res = await request(server, 'GET', '/agents/locked-agent/status', 'sign');
    assert.equal(res.status, 403);
    assert.equal(res.body.ok, false);
  });

  it('returns 404 for unknown agent', async () => {
    const res = await request(server, 'GET', '/agents/nonexistent/status', 'sign');
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
  });

  it('returns 404 for unknown route', async () => {
    const res = await request(server, 'GET', '/unknown', 'sign');
    assert.equal(res.status, 404);
  });

  it('returns application/json content type', async () => {
    const res = await request(server, 'GET', '/agents', 'sign');
    assert.match(res.headers['content-type'], /application\/json/);
  });

  // Status endpoint returns data (may show error if Docker not running, that's ok)
  it('returns 200 for status of controllable agent', async () => {
    const res = await request(server, 'GET', '/agents/test-agent/status', 'sign');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.agent, 'test-agent');
    assert.ok('status' in res.body);
  });
});
