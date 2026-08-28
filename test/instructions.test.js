const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const { createServer } = require('../lib/server');

const WAKE = 'You are waking up for a scheduled work cycle.\nFollow CLAUDE.md.\n\nA line with: a colon, a #hash, and "quotes".\n';
const RESPOND = 'RESPOND cycle only.\n- Read journals\n- Answer Rob\n';

function makeAgentDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-write-'));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Agent Identity\n\n## On Wake\nDo the thing.\n');
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory', 'persona.yaml'), 'tone: direct\n');
  fs.writeFileSync(path.join(dir, 'memory', 'values.yaml'), 'honesty: high\n');
  fs.writeFileSync(path.join(dir, 'agent.yaml'), yaml.dump({
    name: 'test-agent',
    repo: 'owner/test-agent',
    port: 9999,
    'lock-file': '/tmp/test-agent.lock',
    'cron-file': '/etc/cron.d/test-agent',
    'cron-schedule': '0 */2 * * *',
    timezone: 'America/Los_Angeles',
    'wake-prompt': WAKE,
    'respond-prompt': RESPOND,
  }));
  return dir;
}

function makeFrameworkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-write-fw-'));
  fs.mkdirSync(path.join(dir, 'instructions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'instructions', 'journaling.md'), '# Journaling\nshared\n');
  return dir;
}

async function startServer(agentDir, frameworkDir, lockFile) {
  const routes = {};
  const config = {
    name: 'T', port: 0, agentDir, frameworkDir, lockFile, globalInstructionsFile: null,
    _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] },
  };
  require('../lib/routes/instructions').register(routes, config);
  const server = createServer(config, { routes, getHTML: () => '<html>t</html>' });
  await new Promise(r => server.listen(0, r));
  return { server, port: server.address().port };
}

function api(port, p, opts) {
  return fetch(`http://localhost:${port}${p}`, opts);
}

describe('instructions write path', () => {
  let agentDir, frameworkDir, server, port;

  before(async () => {
    agentDir = makeAgentDir();
    frameworkDir = makeFrameworkDir();
    ({ server, port } = await startServer(agentDir, frameworkDir, null));
  });

  after(() => {
    server.close();
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(frameworkDir, { recursive: true, force: true });
  });

  it('round-trips a plain file edit', async () => {
    const next = '# Agent Identity\n\n## On Wake\nEdited by the portal.\n';
    const put = await api(port, '/api/instructions/claude-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: next }),
    });
    assert.equal(put.status, 200);
    assert.equal(fs.readFileSync(path.join(agentDir, 'CLAUDE.md'), 'utf-8'), next);

    const got = await (await api(port, '/api/instructions')).json();
    assert.equal(got.instructions.find(i => i.id === 'claude-md').content, next);
  });

  it('round-trips a multi-line prompt without mangling it', async () => {
    const next = 'New wake prompt.\n\nWith: a colon, a #hash, "quotes", and a trailing blank.\n\n';
    const put = await api(port, '/api/instructions/wake-prompt', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: next }),
    });
    assert.equal(put.status, 200);

    const doc = yaml.load(fs.readFileSync(path.join(agentDir, 'agent.yaml'), 'utf-8'));
    assert.equal(doc['wake-prompt'], next);
    assert.equal(doc['respond-prompt'], RESPOND);
  });

  it('preserves every other agent.yaml key on a prompt write', async () => {
    const before = yaml.load(fs.readFileSync(path.join(agentDir, 'agent.yaml'), 'utf-8'));
    await api(port, '/api/instructions/respond-prompt', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'shorter respond prompt\n' }),
    });
    const after = yaml.load(fs.readFileSync(path.join(agentDir, 'agent.yaml'), 'utf-8'));
    for (const k of ['name', 'repo', 'port', 'lock-file', 'cron-file', 'cron-schedule', 'timezone']) {
      assert.deepEqual(after[k], before[k], 'lost key: ' + k);
    }
  });

  it('rejects a write to a shared instruction with 403', async () => {
    const res = await api(port, '/api/instructions/shared-journaling', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'nope' }),
    });
    assert.equal(res.status, 403);
    assert.equal(fs.readFileSync(path.join(frameworkDir, 'instructions', 'journaling.md'), 'utf-8'), '# Journaling\nshared\n');
  });

  it('rejects an unknown id with 403', async () => {
    const res = await api(port, '/api/instructions/operational', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'nope' }),
    });
    assert.equal(res.status, 403);
  });

  it('rejects a stale write with 409 and leaves the file alone', async () => {
    const before = fs.readFileSync(path.join(agentDir, 'CLAUDE.md'), 'utf-8');
    const res = await api(port, '/api/instructions/claude-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'clobber', modified: '2001-01-01T00:00:00.000Z' }),
    });
    assert.equal(res.status, 409);
    assert.equal(fs.readFileSync(path.join(agentDir, 'CLAUDE.md'), 'utf-8'), before);
  });

  it('accepts a write carrying the current modified stamp', async () => {
    const got = await (await api(port, '/api/instructions')).json();
    const entry = got.instructions.find(i => i.id === 'persona');
    const res = await api(port, '/api/instructions/persona', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'tone: warmer\n', modified: entry.modified }),
    });
    assert.equal(res.status, 200);
  });

  it('rejects a non-string content with 400', async () => {
    const res = await api(port, '/api/instructions/claude-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { not: 'a string' } }),
    });
    assert.equal(res.status, 400);
  });
});

describe('instructions write path — cycle guard', () => {
  let agentDir, frameworkDir, server, port, lockFile;

  before(async () => {
    agentDir = makeAgentDir();
    frameworkDir = makeFrameworkDir();
    lockFile = path.join(agentDir, 'cycle.lock');
    fs.writeFileSync(lockFile + '.starting', String(process.pid));
    ({ server, port } = await startServer(agentDir, frameworkDir, lockFile));
  });

  after(() => {
    server.close();
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(frameworkDir, { recursive: true, force: true });
  });

  it('reports cycleRunning on GET', async () => {
    const got = await (await api(port, '/api/instructions')).json();
    assert.equal(got.cycleRunning, true);
  });

  it('refuses to save while a cycle is running', async () => {
    const before = fs.readFileSync(path.join(agentDir, 'CLAUDE.md'), 'utf-8');
    const res = await api(port, '/api/instructions/claude-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'written during a cycle' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.cycleRunning, true);
    assert.equal(fs.readFileSync(path.join(agentDir, 'CLAUDE.md'), 'utf-8'), before);
  });
});

describe('agent.yaml validation', () => {
  const { buildAgentYaml } = require('../lib/instructions');

  it('round-trips a multi-line block scalar', () => {
    const raw = yaml.dump({ name: 'a', 'wake-prompt': 'one\ntwo\n' });
    const out = buildAgentYaml(raw, 'wake-prompt', 'three\nfour\n');
    assert.equal(yaml.load(out)['wake-prompt'], 'three\nfour\n');
    assert.equal(yaml.load(out).name, 'a');
  });

  it('throws rather than dropping sibling keys', () => {
    const raw = yaml.dump({ name: 'a', port: 1, 'wake-prompt': 'x\n' });
    const out = buildAgentYaml(raw, 'wake-prompt', 'y\n');
    const reloaded = yaml.load(out);
    assert.equal(reloaded.name, 'a');
    assert.equal(reloaded.port, 1);
  });

  it('throws on a source file that is not a mapping', () => {
    assert.throws(() => buildAgentYaml('- just\n- a\n- list\n', 'wake-prompt', 'x'));
  });

  it('survives content that looks like YAML syntax', () => {
    const raw = yaml.dump({ name: 'a', 'wake-prompt': 'x\n' });
    const nasty = 'name: hijacked\nport: 0\n---\nnot: a document\n';
    const out = buildAgentYaml(raw, 'wake-prompt', nasty);
    const reloaded = yaml.load(out);
    assert.equal(reloaded.name, 'a');
    assert.equal(reloaded['wake-prompt'], nasty);
  });
});

describe('global ~/.claude/CLAUDE.md as Shared Core', () => {
  let agentDir, frameworkDir, globalFile, server, port;

  before(async () => {
    agentDir = makeAgentDir();
    frameworkDir = makeFrameworkDir();
    globalFile = path.join(frameworkDir, 'GLOBAL_CLAUDE.md');
    fs.writeFileSync(globalFile, '## Pace\n\nEach scheduled cycle is a real work block.\n');

    const routes = {};
    const config = {
      name: 'T', port: 0, agentDir, frameworkDir, lockFile: null,
      globalInstructionsFile: globalFile,
      _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] },
    };
    require('../lib/routes/instructions').register(routes, config);
    server = createServer(config, { routes, getHTML: () => '<html>t</html>' });
    await new Promise(r => server.listen(0, r));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(agentDir, { recursive: true, force: true });
    fs.rmSync(frameworkDir, { recursive: true, force: true });
  });

  it('exposes the global file as shared and read-only', async () => {
    const data = await (await api(port, '/api/instructions')).json();
    const g = data.instructions.find(i => i.id === 'shared-global-claude-md');
    assert.ok(g, 'global CLAUDE.md should be listed');
    assert.equal(g.scope, 'shared');
    assert.equal(g.editable, false);
    assert.equal(g.label, 'Global');
    assert.match(g.content, /Each scheduled cycle is a real work block/);
  });

  it('orders the global file first within the shared group', async () => {
    const data = await (await api(port, '/api/instructions')).json();
    const shared = data.instructions.filter(i => i.scope === 'shared');
    assert.equal(shared[0].id, 'shared-global-claude-md');
  });

  it('refuses to write the global file', async () => {
    const before = fs.readFileSync(globalFile, 'utf-8');
    const res = await api(port, '/api/instructions/shared-global-claude-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hijacked' }),
    });
    assert.equal(res.status, 403);
    assert.equal(fs.readFileSync(globalFile, 'utf-8'), before);
  });

  it('refuses history for the global file', async () => {
    const res = await api(port, '/api/instructions/shared-global-claude-md/history');
    assert.equal(res.status, 403);
  });

  it('omits it cleanly when the file does not exist', async () => {
    const routes = {};
    const config = {
      name: 'N', port: 0, agentDir, frameworkDir, lockFile: null,
      globalInstructionsFile: path.join(frameworkDir, 'does-not-exist.md'),
      _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] },
    };
    require('../lib/routes/instructions').register(routes, config);
    const s2 = createServer(config, { routes, getHTML: () => '<html>t</html>' });
    await new Promise(r => s2.listen(0, r));
    try {
      const data = await (await api(s2.address().port, '/api/instructions')).json();
      assert.ok(!data.instructions.some(i => i.id === 'shared-global-claude-md'));
    } finally {
      s2.close();
    }
  });

  it('labels the agent CLAUDE.md "Core", not "Identity"', async () => {
    const data = await (await api(port, '/api/instructions')).json();
    const core = data.instructions.find(i => i.id === 'claude-md');
    assert.equal(core.label, 'Core');
  });
});

describe('AGENTS.md is optional and surfaced when present', () => {
  let dir, frameworkDir, server, port;

  before(async () => {
    dir = makeAgentDir();
    frameworkDir = makeFrameworkDir();
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# FleetHD Reviewer\n\n## HARD CONSTRAINTS\nnever violate\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# See AGENTS.md\n\nInstructions live in AGENTS.md.\n');
    ({ server, port } = await startServer(dir, frameworkDir, null));
  });

  after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(frameworkDir, { recursive: true, force: true });
  });

  it('lists AGENTS.md immediately after Core', async () => {
    const data = await (await api(port, '/api/instructions')).json();
    const ids = data.instructions.filter(i => i.scope === 'agent').map(i => i.id);
    assert.equal(ids[0], 'claude-md');
    assert.equal(ids[1], 'agents-md');
  });

  it('returns its full content and marks it editable', async () => {
    const data = await (await api(port, '/api/instructions')).json();
    const a = data.instructions.find(i => i.id === 'agents-md');
    assert.ok(a);
    assert.equal(a.label, 'Agents');
    assert.equal(a.source, 'AGENTS.md');
    assert.equal(a.scope, 'agent');
    assert.equal(a.editable, true);
    assert.match(a.content, /HARD CONSTRAINTS/);
  });

  it('round-trips an edit', async () => {
    const next = '# FleetHD Reviewer\n\n## HARD CONSTRAINTS\nedited via portal\n';
    const res = await api(port, '/api/instructions/agents-md', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: next }),
    });
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8'), next);
  });

  it('is omitted entirely for agents without one', async () => {
    const plain = makeAgentDir();
    const fw2 = makeFrameworkDir();
    const s2 = await startServer(plain, fw2, null);
    try {
      const data = await (await api(s2.port, '/api/instructions')).json();
      assert.ok(!data.instructions.some(i => i.id === 'agents-md'),
        'agents without AGENTS.md should not get an empty card');
    } finally {
      s2.server.close();
      fs.rmSync(plain, { recursive: true, force: true });
      fs.rmSync(fw2, { recursive: true, force: true });
    }
  });
});
