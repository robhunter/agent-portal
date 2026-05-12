const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { getDataDir, dataPath } = require('../lib/helpers');

describe('getDataDir', () => {
  it('returns "." when config is undefined', () => {
    assert.equal(getDataDir(undefined), '.');
  });

  it('returns "." when config has no dataDir', () => {
    assert.equal(getDataDir({}), '.');
  });

  it('returns "." for empty-string dataDir (backwards compat fallback)', () => {
    assert.equal(getDataDir({ dataDir: '' }), '.');
  });

  it('returns the configured dataDir value', () => {
    assert.equal(getDataDir({ dataDir: 'data' }), 'data');
  });

  it('preserves nested dataDir paths', () => {
    assert.equal(getDataDir({ dataDir: 'state/agent-data' }), 'state/agent-data');
  });
});

describe('dataPath', () => {
  it('joins agentDir + "." + parts when dataDir is unset', () => {
    const result = dataPath({ agentDir: '/agent' }, 'logs', 'events.jsonl');
    assert.equal(result, path.join('/agent', '.', 'logs', 'events.jsonl'));
  });

  it('joins agentDir + dataDir + parts when dataDir is set', () => {
    const result = dataPath({ agentDir: '/agent', dataDir: 'data' }, 'memory', 'preferences.yaml');
    assert.equal(result, path.join('/agent', 'data', 'memory', 'preferences.yaml'));
  });

  it('resolves to identical absolute path for default and "." (regression guard)', () => {
    const defaulted = path.resolve(dataPath({ agentDir: '/agent' }, 'logs'));
    const explicit = path.resolve(dataPath({ agentDir: '/agent', dataDir: '.' }, 'logs'));
    assert.equal(defaulted, explicit);
  });

  it('falls back to "." for agentDir when config has no agentDir', () => {
    const result = dataPath({}, 'logs');
    assert.equal(result, path.join('.', '.', 'logs'));
  });

  it('accepts zero subpath parts (returns the data dir itself)', () => {
    assert.equal(dataPath({ agentDir: '/agent', dataDir: 'data' }), path.join('/agent', 'data'));
  });
});

describe('index.js pre-creates dataDir subdirs', () => {
  it('creates <dataDir>/journals and <dataDir>/logs on portal boot', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-dir-boot-'));
    try {
      const agentDir = path.join(tmpRoot, 'agent');
      fs.mkdirSync(agentDir, { recursive: true });
      const configPath = path.join(tmpRoot, 'portal.config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        name: 'BootTest',
        port: 0, // ephemeral
        agentDir,
        dataDir: 'data',
        cronFile: '/nonexistent/cron',
        lockFile: path.join(tmpRoot, 'lock'),
        pidFile: path.join(tmpRoot, 'pid'),
      }));

      // Boot, then kill immediately — we only care about the side effects of index.js startup
      const indexPath = path.resolve(__dirname, '..', 'index.js');
      const child = execSync(
        `node -e "process.argv=[process.argv[0],'${indexPath}','${configPath}'];require('${indexPath}');setTimeout(()=>process.exit(0),100);"`,
        { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }
      );

      assert.ok(fs.existsSync(path.join(agentDir, 'data', 'journals')), 'data/journals should be created');
      assert.ok(fs.existsSync(path.join(agentDir, 'data', 'logs')), 'data/logs should be created');
      // Old root-level paths should NOT be created when dataDir is set
      assert.ok(!fs.existsSync(path.join(agentDir, 'journals')), 'root journals should NOT be created');
      assert.ok(!fs.existsSync(path.join(agentDir, 'logs')), 'root logs should NOT be created');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('preserves legacy behavior when dataDir is unset (creates root-level dirs)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-dir-legacy-'));
    try {
      const agentDir = path.join(tmpRoot, 'agent');
      fs.mkdirSync(agentDir, { recursive: true });
      const configPath = path.join(tmpRoot, 'portal.config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        name: 'LegacyTest',
        port: 0,
        agentDir,
        cronFile: '/nonexistent/cron',
        lockFile: path.join(tmpRoot, 'lock'),
        pidFile: path.join(tmpRoot, 'pid'),
      }));

      const indexPath = path.resolve(__dirname, '..', 'index.js');
      execSync(
        `node -e "process.argv=[process.argv[0],'${indexPath}','${configPath}'];require('${indexPath}');setTimeout(()=>process.exit(0),100);"`,
        { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }
      );

      assert.ok(fs.existsSync(path.join(agentDir, 'journals')), 'legacy root journals should be created');
      assert.ok(fs.existsSync(path.join(agentDir, 'logs')), 'legacy root logs should be created');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('read-harness-config.sh exports DATA_DIR', () => {
  it('emits DATA_DIR="." when portal.config.json has no dataDir', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-dir-shell-default-'));
    try {
      fs.writeFileSync(path.join(tmpRoot, 'portal.config.json'), JSON.stringify({ name: 'T' }));
      const scriptPath = path.resolve(__dirname, '..', 'scripts', 'read-harness-config.sh');
      const output = execSync(`bash "${scriptPath}" "${tmpRoot}"`, { encoding: 'utf-8' });
      assert.match(output, /export DATA_DIR='?\.'?/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('emits the configured dataDir', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-dir-shell-set-'));
    try {
      fs.writeFileSync(path.join(tmpRoot, 'portal.config.json'), JSON.stringify({ name: 'T', dataDir: 'data' }));
      const scriptPath = path.resolve(__dirname, '..', 'scripts', 'read-harness-config.sh');
      const output = execSync(`bash "${scriptPath}" "${tmpRoot}"`, { encoding: 'utf-8' });
      assert.match(output, /export DATA_DIR='?data'?/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
