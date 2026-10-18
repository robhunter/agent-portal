const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');

function createCapabilitiesServer(tmpDir) {
  const config = {
    name: 'Test',
    port: 0,
    agentDir: tmpDir,
    globalInstructionsFile: null,
    _serverStartTime: Date.now(),
    authors: {},
    features: {
      tabs: ['journal', 'status', 'capabilities'],
    },
  };

  const routes = {};
  require('../lib/routes/capabilities').register(routes, config);
  return { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }), config };
}

async function fetchJSON(port, urlPath) {
  const res = await fetch(`http://localhost:${port}${urlPath}`);
  return res.json();
}

describe('GET /api/capabilities', () => {
  let tmpDir, server, port;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capabilities-test-'));

    // Create tools directory with a script
    fs.mkdirSync(path.join(tmpDir, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'tools', 'helper.sh'), '#!/bin/bash\n# My helper script\necho hello');

    // Create skills directory with a skill
    fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'skills', 'test-skill.md'),
      '# Skill: Test Skill\n\n## When to use\n- Testing things\n- Verifying results\n\n## Steps\n1. Do the thing\n');

    // Create .mcp.json
    fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        'test-server': { url: 'https://example.com/mcp' },
      },
    }));

    // Create agent.yaml with workspaces
    fs.writeFileSync(path.join(tmpDir, 'agent.yaml'),
      'name: test-agent\nworkspaces:\n  - repo: owner/repo1\n    path: /tmp/repo1\n  - repo: owner/repo2\n    path: /tmp/repo2\n');

    const { server: s } = createCapabilitiesServer(tmpDir);
    server = s;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(async () => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns MCP servers from .mcp.json', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    assert.ok(Array.isArray(data.mcpServers));
    assert.equal(data.mcpServers.length, 1);
    assert.equal(data.mcpServers[0].name, 'test-server');
    assert.equal(data.mcpServers[0].url, 'https://example.com/mcp');
  });

  it('returns scripts from tools/', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    assert.ok(Array.isArray(data.scripts));
    assert.equal(data.scripts.length, 1);
    assert.equal(data.scripts[0].name, 'helper.sh');
    assert.equal(data.scripts[0].description, 'My helper script');
  });

  it('returns skills from skills/', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    assert.ok(Array.isArray(data.skills));
    assert.equal(data.skills.length, 1);
    assert.equal(data.skills[0].description, 'Test Skill');
    assert.ok(data.skills[0].whenToUse.includes('Testing things'));
  });

  it('returns workspaces from agent.yaml', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    assert.ok(Array.isArray(data.workspaces));
    assert.equal(data.workspaces.length, 2);
    assert.equal(data.workspaces[0].repo, 'owner/repo1');
    assert.equal(data.workspaces[1].repo, 'owner/repo2');
  });

  it('handles empty directories gracefully', async () => {
    // Create a server with an empty agent dir
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-empty-'));
    const { server: s2 } = createCapabilitiesServer(emptyDir);
    await new Promise(resolve => s2.listen(0, resolve));
    const port2 = s2.address().port;

    const data = await fetchJSON(port2, '/api/capabilities');
    assert.deepEqual(data.mcpServers, []);
    assert.deepEqual(data.scripts, []);
    assert.deepEqual(data.skills, []);
    assert.deepEqual(data.workspaces, []);

    s2.close();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe('GET /api/capabilities — instructions', () => {
  let tmpDir, frameworkDir, server, port;

  const WAKE = 'You are waking up for a scheduled work cycle.\nFollow CLAUDE.md.\n\nSecond paragraph with: a colon and a #hash.\n';
  const RESPOND = 'RESPOND cycle only.\n- Read journals\n- Answer Rob\n';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-agent-'));
    frameworkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-fw-'));

    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Agent Identity\n\n## On Wake\nDo the thing.\n');
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'memory', 'persona.yaml'), 'tone: direct\n');
    fs.writeFileSync(path.join(tmpDir, 'memory', 'values.yaml'), 'honesty: high\n');
    fs.writeFileSync(path.join(tmpDir, 'memory', 'operational.yaml'), 'learnings: many\n');

    const yaml = require('js-yaml');
    fs.writeFileSync(path.join(tmpDir, 'agent.yaml'), yaml.dump({
      name: 'test-agent',
      port: 9999,
      'wake-prompt': WAKE,
      'respond-prompt': RESPOND,
    }));

    fs.mkdirSync(path.join(tmpDir, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'skills', 'a-skill.md'), '# Skill: A Skill\n\nbody text\n');

    fs.mkdirSync(path.join(frameworkDir, 'instructions'), { recursive: true });
    fs.writeFileSync(path.join(frameworkDir, 'instructions', 'data-layout.md'), '# Data layout\nshared rules\n');
    fs.writeFileSync(path.join(frameworkDir, 'instructions', 'journaling.md'), '# Journaling\nshared rules\n');

    const routes = {};
    const config = { name: 'T', port: 0, agentDir: tmpDir, frameworkDir, globalInstructionsFile: null, _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] } };
    require('../lib/routes/capabilities').register(routes, config);
    server = createServer(config, { routes, getHTML: () => '<html>t</html>' });
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(frameworkDir, { recursive: true, force: true });
  });

  it('returns all five per-agent instruction sources in order', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    const agentIds = data.instructions.filter(i => i.scope === 'agent').map(i => i.id);
    assert.deepEqual(agentIds, ['claude-md', 'wake-prompt', 'respond-prompt', 'persona', 'values']);
  });

  it('extracts multi-line prompts from agent.yaml intact', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    const wake = data.instructions.find(i => i.id === 'wake-prompt');
    const respond = data.instructions.find(i => i.id === 'respond-prompt');
    assert.equal(wake.content, WAKE);
    assert.equal(respond.content, RESPOND);
    assert.ok(wake.source.includes('agent.yaml'));
  });

  it('marks framework instructions as shared and orders them last', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    const shared = data.instructions.filter(i => i.scope === 'shared');
    assert.equal(shared.length, 2);
    assert.deepEqual(shared.map(i => i.id), ['shared-data-layout', 'shared-journaling']);
    const firstShared = data.instructions.findIndex(i => i.scope === 'shared');
    const lastAgent = data.instructions.map(i => i.scope).lastIndexOf('agent');
    assert.ok(lastAgent < firstShared);
  });

  it('never exposes large agent-authored memory files', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    const sources = data.instructions.map(i => i.source);
    assert.ok(!sources.some(s => s.includes('operational.yaml')));
    assert.ok(!sources.some(s => s.includes('decisions.yaml')));
  });

  it('reports bytes and modified for every entry', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    for (const i of data.instructions) {
      assert.equal(typeof i.bytes, 'number');
      assert.ok(i.bytes > 0);
      assert.ok(!isNaN(new Date(i.modified).getTime()));
      assert.equal(typeof i.content, 'string');
    }
  });

  it('includes content on skills', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    assert.ok(data.skills.length > 0);
    assert.ok(data.skills.every(s => typeof s.content === 'string' && s.content.length > 0));
  });

  it('omits missing sources without erroring (dev-agent shape)', async () => {
    const sparse = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-sparse-'));
    fs.writeFileSync(path.join(sparse, 'CLAUDE.md'), '# Agent Identity\n');
    fs.writeFileSync(path.join(sparse, 'agent.yaml'), 'name: sparse\nwake-prompt: |\n  only a wake prompt\n');

    const routes = {};
    const config = { name: 'S', port: 0, agentDir: sparse, frameworkDir, globalInstructionsFile: null, _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] } };
    require('../lib/routes/capabilities').register(routes, config);
    const s2 = createServer(config, { routes, getHTML: () => '<html>t</html>' });
    await new Promise(resolve => s2.listen(0, resolve));

    const data = await fetchJSON(s2.address().port, '/api/capabilities');
    const ids = data.instructions.filter(i => i.scope === 'agent').map(i => i.id);
    assert.deepEqual(ids, ['claude-md', 'wake-prompt']);

    s2.close();
    fs.rmSync(sparse, { recursive: true, force: true });
  });

  it('returns empty instructions for an agent dir with none', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-empty-'));
    const noFw = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-nofw-'));
    const routes = {};
    const config = { name: 'E', port: 0, agentDir: empty, frameworkDir: noFw, globalInstructionsFile: null, _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] } };
    require('../lib/routes/capabilities').register(routes, config);
    const s2 = createServer(config, { routes, getHTML: () => '<html>t</html>' });
    await new Promise(resolve => s2.listen(0, resolve));

    const data = await fetchJSON(s2.address().port, '/api/capabilities');
    assert.deepEqual(data.instructions, []);

    s2.close();
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(noFw, { recursive: true, force: true });
  });
});

describe('Capabilities tab rendering', () => {
  const js = require('../lib/ui/tabs/capabilities').getCapabilitiesTabJS();

  it('emits parseable client JS', () => {
    assert.doesNotThrow(() => new Function(js));
  });

  it('places Instructions above Shared Core, and both above Skills', () => {
    const i = js.indexOf("<h2>Instructions</h2>");
    const sc = js.indexOf("capSection('Shared Core'");
    const sk = js.indexOf("capSection('Skills'");
    assert.ok(i > -1 && sc > -1 && sk > -1);
    assert.ok(i < sc, 'Instructions before Shared Core');
    assert.ok(sc < sk, 'Shared Core before Skills');
  });

  it('escapes expanded content and never routes it through marked', () => {
    assert.ok(js.includes('escapeHtml(opts.content'));
    assert.ok(!js.includes('marked.parse'));
  });

  it('renders instruction and skill cards as expandable details', () => {
    assert.ok(js.includes('<details class="status-card"'));
    assert.ok(js.includes('capExpandableCard'));
  });

  it('never emits a section header with no cards', () => {
    assert.ok(js.includes('if (!cards || cards.length === 0) return'));
    assert.ok(!/No (MCP servers|skills|scripts|instruction|workspaces)/.test(js),
      'empty-state placeholder text should be gone');
  });
});

describe('Capabilities tab renders no empty section headers', () => {
  const realFetch = global.fetch;
  const realDocument = global.document;
  after(() => {
    global.fetch = realFetch;
    global.document = realDocument;
  });

  function renderAgainst(port) {
    const core = require('../lib/ui/client-core');
    const coreJS = Object.values(core).map(f => (typeof f === 'function' ? f() : '')).join('\n');
    const tabJS = require('../lib/ui/tabs/capabilities').getCapabilitiesTabJS();
    const el = { innerHTML: '' };
    global.document = { getElementById: () => el };
    global.fetch = (u) => new Promise((res, rej) => {
      require('http').get(`http://localhost:${port}${u}`, r => {
        let b = ''; r.on('data', c => b += c); r.on('end', () => res({ json: () => JSON.parse(b) }));
      }).on('error', rej);
    });
    // eslint-disable-next-line no-eval
    eval(coreJS.match(/function escapeHtml[\s\S]*?\n}/)[0]);
    global.escapeHtml = escapeHtml;
    // eslint-disable-next-line no-eval
    eval(tabJS);
    return loadCapabilities().then(() => {
      global.fetch = realFetch;
      global.document = realDocument;
      return el.innerHTML;
    });
  }

  async function serveDir(agentDir, frameworkDir) {
    const routes = {};
    const config = {
      name: 'X', port: 0, agentDir, frameworkDir, globalInstructionsFile: null,
      _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] },
    };
    require('../lib/routes/capabilities').register(routes, config);
    require('../lib/routes/instructions').register(routes, config);
    const server = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(r => server.listen(0, r));
    return server;
  }

  it('renders zero headers and a single message for a bare agent', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bare-'));
    const nofw = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-nofw-'));
    const server = await serveDir(bare, nofw);
    try {
      const html = await renderAgainst(server.address().port);
      const headers = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map(m => m[1]);
      assert.deepEqual(headers, [], 'a bare agent should render no section headers');
      assert.match(html, /Nothing discovered for this agent/);
    } finally {
      server.close();
      fs.rmSync(bare, { recursive: true, force: true });
      fs.rmSync(nofw, { recursive: true, force: true });
    }
  });

  it('renders only the sections that have content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-partial-'));
    const nofw = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-nofw2-'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Identity\n');
    const server = await serveDir(dir, nofw);
    try {
      const html = await renderAgainst(server.address().port);
      const headers = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map(m => m[1]);
      assert.deepEqual(headers, ['Instructions'], 'only Instructions has content');
      assert.ok(!html.includes('Shared Core'));
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(nofw, { recursive: true, force: true });
    }
  });
});

describe('readSkills supports SKILL.md directories and legacy flat files', () => {
  let dir, server, port;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-skills-'));
    fs.mkdirSync(path.join(dir, 'skills', 'writing-outputs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', 'writing-outputs', 'SKILL.md'),
      '---\nname: writing-outputs\ndescription: Writes a review artifact into output/. Use when producing a research doc.\n---\n# Writing outputs\n\nbody\n');
    fs.writeFileSync(path.join(dir, 'skills', 'legacy-thing.md'), '# Skill: Legacy Thing\n\n## When to use\n- Old style\n');

    const routes = {};
    const config = {
      name: 'S', port: 0, agentDir: dir, frameworkDir: dir, globalInstructionsFile: null,
      _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] },
    };
    require('../lib/routes/capabilities').register(routes, config);
    server = createServer(config, { routes, getHTML: () => '<html></html>' });
    await new Promise(r => server.listen(0, r));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a SKILL.md directory and its frontmatter', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    const s = data.skills.find(x => x.name === 'writing-outputs');
    assert.ok(s);
    assert.equal(s.format, 'skill');
    assert.equal(s.filename, path.join('writing-outputs', 'SKILL.md'));
    assert.match(s.description, /Use when producing a research doc/);
    assert.match(s.content, /body/);
  });

  it('still reads legacy flat files', async () => {
    const data = await fetchJSON(port, '/api/capabilities');
    const s = data.skills.find(x => x.filename === 'legacy-thing.md');
    assert.ok(s);
    assert.equal(s.format, 'legacy');
    assert.equal(s.description, 'Legacy Thing');
  });

  it('ignores a directory without SKILL.md', async () => {
    fs.mkdirSync(path.join(dir, 'skills', 'conventions'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', 'conventions', 'notes.md'), 'not a skill\n');
    const data = await fetchJSON(port, '/api/capabilities');
    assert.ok(!data.skills.some(x => x.name === 'conventions'));
  });
});
