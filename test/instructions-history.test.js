const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');
const { createServer } = require('../lib/server');
const { instructionHistory, instructionAtRevision } = require('../lib/instructions');

const WAKE_V1 = 'Wake prompt version one.\nSecond line.\n';
const WAKE_V2 = 'Wake prompt version two.\nChanged.\n';

function git(dir, args) {
  execFileSync('git', ['-C', dir].concat(args), { stdio: 'ignore', timeout: 15000 });
}

function commitAll(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', message]);
}

function writeYaml(dir, doc) {
  fs.writeFileSync(path.join(dir, 'agent.yaml'), yaml.dump(doc));
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-hist-'));
  git(dir, ['init', '-q']);

  const base = {
    name: 'test-agent',
    port: 9999,
    'lock-file': '/tmp/test-agent.lock',
    'cron-file': '/etc/cron.d/test-agent',
    'cron-schedule': '0 */2 * * *',
    'wake-prompt': WAKE_V1,
    'framework-last-known-good': 'aaaaaaa',
  };
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Identity v1\n');
  writeYaml(dir, base);
  commitAll(dir, 'seed');

  writeYaml(dir, Object.assign({}, base, { 'framework-last-known-good': 'bbbbbbb' }));
  commitAll(dir, '2026-08-26 — autonomous cycle');

  writeYaml(dir, Object.assign({}, base, { 'framework-last-known-good': 'ccccccc', 'wake-prompt': WAKE_V2 }));
  commitAll(dir, 'change the wake prompt');

  writeYaml(dir, Object.assign({}, base, { 'framework-last-known-good': 'ddddddd', 'wake-prompt': WAKE_V2 }));
  commitAll(dir, '2026-08-27 — autonomous cycle');

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Identity v2\n');
  commitAll(dir, 'edit identity');

  return dir;
}

async function startServer(agentDir) {
  const routes = {};
  const config = {
    name: 'T', port: 0, agentDir, frameworkDir: agentDir, lockFile: null,
    _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] },
  };
  require('../lib/routes/instructions').register(routes, config);
  const server = createServer(config, { routes, getHTML: () => '<html>t</html>' });
  await new Promise(r => server.listen(0, r));
  return { server, port: server.address().port };
}

describe('instruction history', () => {
  let dir, server, port;

  before(async () => {
    dir = makeRepo();
    ({ server, port } = await startServer(dir));
  });

  after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignores agent.yaml revisions that only bumped framework-last-known-good', () => {
    const revs = instructionHistory(dir, 'wake-prompt');
    assert.equal(revs.length, 2, 'expected only the two revisions that changed the prompt');
    assert.equal(revs[0].message, 'change the wake prompt');
    assert.equal(revs[1].message, 'seed');
  });

  it('includes revisions that did change the prompt', () => {
    const revs = instructionHistory(dir, 'wake-prompt');
    assert.equal(instructionAtRevision(dir, 'wake-prompt', revs[0].sha), WAKE_V2);
    assert.equal(instructionAtRevision(dir, 'wake-prompt', revs[1].sha), WAKE_V1);
  });

  it('returns plain-file history newest first', () => {
    const revs = instructionHistory(dir, 'claude-md');
    assert.ok(revs.length >= 2);
    assert.equal(revs[0].message, 'edit identity');
    assert.equal(instructionAtRevision(dir, 'claude-md', revs[0].sha), '# Identity v2\n');
  });

  it('rejects a non-sha revision reference', () => {
    assert.equal(instructionAtRevision(dir, 'claude-md', 'HEAD; rm -rf /'), null);
    assert.equal(instructionAtRevision(dir, 'claude-md', '../../etc/passwd'), null);
  });

  it('returns empty history for a directory that is not a git repo', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-nogit-'));
    fs.writeFileSync(path.join(plain, 'CLAUDE.md'), '# no repo\n');
    assert.deepEqual(instructionHistory(plain, 'claude-md'), []);
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('serves history over HTTP', async () => {
    const res = await fetch(`http://localhost:${port}/api/instructions/wake-prompt/history`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.revisions.length, 2);
  });

  it('refuses history for a non-editable id', async () => {
    const res = await fetch(`http://localhost:${port}/api/instructions/shared-journaling/history`);
    assert.equal(res.status, 403);
  });

  it('serves revision content over HTTP', async () => {
    const revs = instructionHistory(dir, 'claude-md');
    const res = await fetch(`http://localhost:${port}/api/instructions/claude-md/history/${revs[1].sha}`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.content, '# Identity v1\n');
  });

  it('404s an unknown revision', async () => {
    const res = await fetch(`http://localhost:${port}/api/instructions/claude-md/history/${'0'.repeat(40)}`);
    assert.equal(res.status, 404);
  });

  it('restores through the write path and produces a new commit', async () => {
    const revs = instructionHistory(dir, 'claude-md');
    const oldest = revs[revs.length - 1];
    const body = await (await fetch(`http://localhost:${port}/api/instructions/claude-md/history/${oldest.sha}`)).json();

    const before = execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim();
    const put = await fetch(`http://localhost:${port}/api/instructions/claude-md`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: body.content }),
    });
    assert.equal(put.status, 200);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8'), '# Identity v1\n');

    const after = execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim();
    assert.equal(Number(after), Number(before) + 1, 'restore should create a commit');
  });
});

describe('instruction history — restore respects the cycle guard', () => {
  let dir, server, port, lockFile;

  before(async () => {
    dir = makeRepo();
    lockFile = path.join(dir, 'cycle.lock');
    fs.writeFileSync(lockFile + '.starting', String(process.pid));

    const routes = {};
    const config = {
      name: 'T', port: 0, agentDir: dir, frameworkDir: dir, lockFile,
      _serverStartTime: Date.now(), authors: {}, features: { tabs: ['capabilities'] },
    };
    require('../lib/routes/instructions').register(routes, config);
    server = createServer(config, { routes, getHTML: () => '<html>t</html>' });
    await new Promise(r => server.listen(0, r));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a restore while a cycle is running', async () => {
    const revs = instructionHistory(dir, 'claude-md');
    const body = await (await fetch(`http://localhost:${port}/api/instructions/claude-md/history/${revs[revs.length - 1].sha}`)).json();
    const before = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8');

    const put = await fetch(`http://localhost:${port}/api/instructions/claude-md`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: body.content }),
    });
    assert.equal(put.status, 409);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8'), before);
  });
});

describe('commit-on-save without an ambient git identity', () => {
  const { writeInstruction } = require('../lib/instructions');
  const IDENTITY_VARS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'];

  it('still commits when git has no configured user anywhere', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-noident-'));
    const saved = {};
    for (const k of IDENTITY_VARS.concat(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'])) saved[k] = process.env[k];
    for (const k of IDENTITY_VARS) delete process.env[k];
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';

    try {
      execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# one\n');
      execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
      execFileSync('git', ['-C', dir, '-c', 'user.name=seed', '-c', 'user.email=s@s', 'commit', '-q', '-m', 'seed'], { stdio: 'ignore' });

      assert.throws(
        () => execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'probe'], { stdio: 'ignore' }),
        'fixture should have no usable git identity',
      );

      const before = Number(execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim());
      const result = writeInstruction(dir, 'claude-md', '# two\n');
      assert.equal(result.committed, true, 'expected a commit even with no ambient identity');
      const after = Number(execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD'], { encoding: 'utf-8' }).trim());
      assert.equal(after, before + 1);
      const author = execFileSync('git', ['-C', dir, 'log', '-1', '--format=%an'], { encoding: 'utf-8' }).trim();
      assert.equal(author, 'agent-portal', 'expected the fallback identity to be used');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
