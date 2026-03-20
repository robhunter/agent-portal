const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');

function createBadgeServer(tmpDir, configOverrides = {}) {
  const config = {
    name: 'Test',
    port: 0,
    agentDir: tmpDir,
    _serverStartTime: Date.now(),
    authors: {},
    features: {
      outputs: true,
      requests: true,
      tabs: ['journal', 'status', 'outputs', 'requests', 'todos'],
    },
    ...configOverrides,
  };

  const routes = {};
  require('../lib/routes/badges').register(routes, config);
  return { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }), config };
}

async function fetchJSON(port, urlPath) {
  const res = await fetch(`http://localhost:${port}${urlPath}`);
  return res.json();
}

describe('GET /api/badges', () => {
  let tmpDir, server, port;

  before((_, done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badges-test-'));
    // Create directory structure
    fs.mkdirSync(path.join(tmpDir, 'output'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'input', 'feedback', 'processed'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'requests'), { recursive: true });

    const { server: s } = createBadgeServer(tmpDir);
    server = s;
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  after((_, done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      done();
    });
  });

  beforeEach(() => {
    // Clean output files
    for (const f of fs.readdirSync(path.join(tmpDir, 'output'))) {
      fs.unlinkSync(path.join(tmpDir, 'output', f));
    }
    for (const f of fs.readdirSync(path.join(tmpDir, 'requests'))) {
      fs.unlinkSync(path.join(tmpDir, 'requests', f));
    }
    // Remove todos file if present
    try { fs.unlinkSync(path.join(tmpDir, 'human_todos.md')); } catch {}
    // Clean feedback
    for (const f of fs.readdirSync(path.join(tmpDir, 'input', 'feedback'))) {
      const fp = path.join(tmpDir, 'input', 'feedback', f);
      if (fs.statSync(fp).isFile()) fs.unlinkSync(fp);
    }
  });

  it('returns empty object when nothing is pending', async () => {
    const data = await fetchJSON(port, '/api/badges');
    assert.deepEqual(data, {});
  });

  it('counts unreviewed outputs', async () => {
    fs.writeFileSync(path.join(tmpDir, 'output', 'report1.md'), '# Report 1');
    fs.writeFileSync(path.join(tmpDir, 'output', 'report2.md'), '# Report 2');
    fs.writeFileSync(path.join(tmpDir, 'output', 'report3.md'), '# Report 3');
    // Mark one as reviewed
    fs.writeFileSync(path.join(tmpDir, 'input', 'feedback', 'report1.feedback.yaml'), 'rating: up');

    const data = await fetchJSON(port, '/api/badges');
    assert.equal(data.outputs, 2);
  });

  it('counts pending requests', async () => {
    fs.writeFileSync(path.join(tmpDir, 'requests', 'req1.md'), '# Request: Test\n**Status:** pending\n');
    fs.writeFileSync(path.join(tmpDir, 'requests', 'req2.md'), '# Request: Done\n**Status:** completed\n');
    fs.writeFileSync(path.join(tmpDir, 'requests', 'req3.md'), '# Request: Also pending\n**Status:** pending\n');

    const data = await fetchJSON(port, '/api/badges');
    assert.equal(data.requests, 2);
  });

  it('counts open todos', async () => {
    fs.writeFileSync(path.join(tmpDir, 'human_todos.md'),
      '## Todos\n\n- [ ] Open 1\n- [x] Done 1\n- [ ] Open 2\n- [ ] Open 3\n\n## Notes\n');

    const data = await fetchJSON(port, '/api/badges');
    assert.equal(data.todos, 3);
  });

  it('omits tabs with zero counts', async () => {
    // Only outputs has items, but all are reviewed
    fs.writeFileSync(path.join(tmpDir, 'output', 'report.md'), '# Report');
    fs.writeFileSync(path.join(tmpDir, 'input', 'feedback', 'report.feedback.yaml'), 'rating: up');

    const data = await fetchJSON(port, '/api/badges');
    assert.equal(data.outputs, undefined);
    assert.equal(data.requests, undefined);
    assert.equal(data.todos, undefined);
  });

  it('returns all badge counts together', async () => {
    fs.writeFileSync(path.join(tmpDir, 'output', 'r1.md'), '# R1');
    fs.writeFileSync(path.join(tmpDir, 'requests', 'req1.md'), '# Req\n**Status:** pending\n');
    fs.writeFileSync(path.join(tmpDir, 'human_todos.md'), '## Todos\n\n- [ ] Do thing\n\n## Notes\n');

    const data = await fetchJSON(port, '/api/badges');
    assert.equal(data.outputs, 1);
    assert.equal(data.requests, 1);
    assert.equal(data.todos, 1);
  });
});

describe('GET /api/badges — disabled features', () => {
  let tmpDir, server, port;

  before((_, done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'badges-disabled-'));
    fs.mkdirSync(path.join(tmpDir, 'output'), { recursive: true });

    const { server: s } = createBadgeServer(tmpDir, {
      features: { tabs: ['journal', 'status'] },
    });
    server = s;
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  after((_, done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      done();
    });
  });

  it('returns empty when badge tabs are not configured', async () => {
    fs.writeFileSync(path.join(tmpDir, 'output', 'r1.md'), '# R1');
    const data = await fetchJSON(port, '/api/badges');
    assert.deepEqual(data, {});
  });
});
