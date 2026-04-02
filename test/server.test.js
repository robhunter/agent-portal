const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createServer, startServer, matchRoute, setupPidFile } = require('../lib/server');
const os = require('os');

// --- matchRoute ---

describe('matchRoute', () => {
  it('matches exact routes', () => {
    const match = matchRoute('GET /api/status', 'GET /api/status');
    assert.deepEqual(match, {});
  });

  it('returns null for method mismatch', () => {
    const match = matchRoute('POST /api/status', 'GET /api/status');
    assert.equal(match, null);
  });

  it('returns null for path mismatch', () => {
    const match = matchRoute('GET /api/status', 'GET /api/journal');
    assert.equal(match, null);
  });

  it('matches parameterized routes', () => {
    const match = matchRoute('GET /api/projects/:slug/journal', 'GET /api/projects/my-project/journal');
    assert.deepEqual(match, { slug: 'my-project' });
  });

  it('matches multiple params', () => {
    const match = matchRoute('GET /api/:type/:id', 'GET /api/projects/123');
    assert.deepEqual(match, { type: 'projects', id: '123' });
  });

  it('returns null for different path lengths', () => {
    const match = matchRoute('GET /api/status', 'GET /api/status/extra');
    assert.equal(match, null);
  });

  it('decodes URI components in params', () => {
    const match = matchRoute('GET /api/projects/:slug', 'GET /api/projects/my%20project');
    assert.deepEqual(match, { slug: 'my project' });
  });
});

// --- createServer ---

describe('createServer', () => {
  let server;
  let port;

  after(() => {
    if (server) server.close();
  });

  it('routes API requests to registered handlers', async () => {
    const routes = {
      'GET /api/test': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    };

    const config = { name: 'Test', port: 0 };
    server = createServer(config, { routes, getHTML: () => '<html>test</html>' });

    await new Promise(resolve => {
      server.listen(0, resolve);
    });
    port = server.address().port;

    const res = await fetch(`http://localhost:${port}/api/test`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, { ok: true });
  });

  it('returns 404 for unregistered API routes', async () => {
    const res = await fetch(`http://localhost:${port}/api/nonexistent`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'Not found');
  });

  it('serves SPA HTML for non-API routes', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    const body = await res.text();
    assert.ok(body.includes('test'));
  });

  it('serves SPA HTML for arbitrary non-API paths (fallback)', async () => {
    const res = await fetch(`http://localhost:${port}/some/random/path`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('test'));
  });

  it('routes parameterized API requests', async () => {
    server.close();

    const routes = {
      'GET /api/items/:id': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: req.params.id }));
      }
    };

    const config = { name: 'Test', port: 0 };
    server = createServer(config, { routes, getHTML: () => '<html></html>' });

    await new Promise(resolve => {
      server.listen(0, resolve);
    });
    port = server.address().port;

    const res = await fetch(`http://localhost:${port}/api/items/42`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data, { id: '42' });
  });

  it('returns 500 when a route handler throws', async () => {
    server.close();

    const routes = {
      'GET /api/error': () => { throw new Error('boom'); }
    };

    const config = { name: 'Test', port: 0 };
    server = createServer(config, { routes, getHTML: () => '<html></html>' });

    await new Promise(resolve => {
      server.listen(0, resolve);
    });
    port = server.address().port;

    const res = await fetch(`http://localhost:${port}/api/error`);
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.error, 'Internal server error');
  });
});

// --- Tailscale auth middleware ---

describe('Tailscale auth middleware', () => {
  it('allows requests when auth is not configured', async () => {
    const routes = {
      'GET /api/test': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    };
    const config = { name: 'Test', port: 0 };
    const srv = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/api/test`);
    assert.equal(res.status, 200);
    srv.close();
  });

  it('allows requests when allowedUsers is empty array', async () => {
    const routes = {
      'GET /api/test': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    };
    const config = { name: 'Test', port: 0, auth: { allowedUsers: [] } };
    const srv = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/api/test`);
    assert.equal(res.status, 200);
    srv.close();
  });

  it('returns 401 when auth is configured but no identity header', async () => {
    const routes = {
      'GET /api/test': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    };
    const config = { name: 'Test', port: 0, auth: { allowedUsers: ['rob@github'] } };
    const srv = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/api/test`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.ok(data.error.includes('Unauthorized'));
    srv.close();
  });

  it('returns 403 when user is not in allowedUsers', async () => {
    const routes = {
      'GET /api/test': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    };
    const config = { name: 'Test', port: 0, auth: { allowedUsers: ['rob@github'] } };
    const srv = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/api/test`, {
      headers: { 'Tailscale-User-Login': 'evil@github' }
    });
    assert.equal(res.status, 403);
    srv.close();
  });

  it('allows requests from users in allowedUsers', async () => {
    const routes = {
      'GET /api/test': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: req.tailscaleUser }));
      }
    };
    const config = { name: 'Test', port: 0, auth: { allowedUsers: ['rob@github'] } };
    const srv = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/api/test`, {
      headers: {
        'Tailscale-User-Login': 'rob@github',
        'Tailscale-User-Name': 'Rob Hunter'
      }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.user.login, 'rob@github');
    assert.equal(data.user.name, 'Rob Hunter');
    srv.close();
  });

  it('exempts /api/health from auth', async () => {
    const routes = {
      'GET /api/health': (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }
    };
    const config = { name: 'Test', port: 0, auth: { allowedUsers: ['rob@github'] } };
    const srv = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/api/health`);
    assert.equal(res.status, 200);
    srv.close();
  });

  it('blocks non-API routes (SPA) when auth is configured and no identity', async () => {
    const config = { name: 'Test', port: 0, auth: { allowedUsers: ['rob@github'] } };
    const srv = createServer(config, { routes: {}, getHTML: () => '<html></html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/`);
    assert.equal(res.status, 401);
    srv.close();
  });

  it('allows SPA routes with valid identity', async () => {
    const config = { name: 'Test', port: 0, auth: { allowedUsers: ['rob@github'] } };
    const srv = createServer(config, { routes: {}, getHTML: () => '<html>portal</html>' });
    await new Promise(resolve => srv.listen(0, resolve));
    const port = srv.address().port;

    const res = await fetch(`http://localhost:${port}/`, {
      headers: { 'Tailscale-User-Login': 'rob@github' }
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('portal'));
    srv.close();
  });
});

// --- setupPidFile ---

describe('setupPidFile', () => {
  it('writes PID to file', () => {
    const pidFile = path.join(os.tmpdir(), `portal-test-pid-${Date.now()}.pid`);
    try {
      setupPidFile(pidFile);
      const content = fs.readFileSync(pidFile, 'utf-8');
      assert.equal(content, String(process.pid));
    } finally {
      try { fs.unlinkSync(pidFile); } catch {}
    }
  });
});
