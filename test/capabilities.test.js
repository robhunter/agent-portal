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
