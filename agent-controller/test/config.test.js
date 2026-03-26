const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { load, validate, getAgent, getCallerByUid } = require('../lib/config');

function writeConfig(dir, config) {
  const yaml = require('js-yaml');
  const p = path.join(dir, 'agent-controller.yaml');
  fs.writeFileSync(p, yaml.dump(config));
  return p;
}

function baseConfig() {
  return {
    listen: '0.0.0.0:9090',
    agents_root: '/tmp/agents',
    framework_dir: '/tmp/framework',
    auth: {
      callers: {
        agentbox: {
          uid: 'agent-test123',
          public_jwk: '{"crv":"Ed25519","x":"abc","kty":"OKP","kid":"def"}',
        },
      },
    },
    agents: {
      'test-agent': {
        dir: 'test-agent',
        controllable: true,
        deployment: 'sandcat',
        permissions: {
          agentbox: ['restart', 'logs', 'status'],
        },
      },
    },
  };
}

describe('config', () => {
  let tmpDir;

  it('parses a valid config file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const configPath = writeConfig(tmpDir, baseConfig());
    const config = load(configPath);

    assert.equal(config.listen.host, '0.0.0.0');
    assert.equal(config.listen.port, 9090);
    assert.equal(config.agentsRoot, '/tmp/agents');
    assert.equal(config.frameworkDir, '/tmp/framework');
    assert.ok(config.agents['test-agent']);
    assert.equal(config.agents['test-agent'].controllable, true);
    assert.equal(config.agents['test-agent'].dir, '/tmp/agents/test-agent');
    assert.ok(config.agents['test-agent'].permissions.agentbox instanceof Set);
    assert.ok(config.agents['test-agent'].permissions.agentbox.has('restart'));
  });

  it('rejects config with missing agents_root', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    delete raw.agents_root;
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /agents_root/);
  });

  it('rejects config with missing framework_dir', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    delete raw.framework_dir;
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /framework_dir/);
  });

  it('rejects config with missing listen', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    delete raw.listen;
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /listen/);
  });

  it('rejects config with invalid listen format', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    raw.listen = 'invalid';
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /Invalid listen format/);
  });

  it('rejects config with missing auth.callers', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    delete raw.auth;
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /auth\.callers/);
  });

  it('rejects caller with missing uid', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    delete raw.auth.callers.agentbox.uid;
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /uid/);
  });

  it('rejects caller with missing public_jwk', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    delete raw.auth.callers.agentbox.public_jwk;
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /public_jwk/);
  });

  it('rejects controllable agent with no permissions', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    delete raw.agents['test-agent'].permissions;
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /controllable but has no permissions/);
  });

  it('rejects unknown permission names', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    raw.agents['test-agent'].permissions.agentbox = ['restart', 'destroy'];
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /unknown permission 'destroy'/);
  });

  it('rejects invalid deployment type', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    raw.agents['test-agent'].deployment = 'kubernetes';
    const configPath = writeConfig(tmpDir, raw);
    assert.throws(() => load(configPath), /invalid deployment/);
  });

  it('handles controllable: false agents without permissions', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    raw.agents['locked-agent'] = { dir: 'locked', controllable: false };
    const configPath = writeConfig(tmpDir, raw);
    const config = load(configPath);
    assert.equal(config.agents['locked-agent'].controllable, false);
  });

  it('returns null for unknown agent names', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const configPath = writeConfig(tmpDir, baseConfig());
    const config = load(configPath);
    assert.equal(getAgent(config, 'nonexistent'), null);
  });

  it('returns agent for known names', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const configPath = writeConfig(tmpDir, baseConfig());
    const config = load(configPath);
    const agent = getAgent(config, 'test-agent');
    assert.equal(agent.name, 'test-agent');
  });

  it('maps caller UID to caller identity', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const configPath = writeConfig(tmpDir, baseConfig());
    const config = load(configPath);
    const caller = getCallerByUid(config, 'agent-test123');
    assert.equal(caller.callerId, 'agentbox');
    assert.deepEqual(caller.publicJwk, { crv: 'Ed25519', x: 'abc', kty: 'OKP', kid: 'def' });
  });

  it('returns null for unknown caller UID', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const configPath = writeConfig(tmpDir, baseConfig());
    const config = load(configPath);
    assert.equal(getCallerByUid(config, 'agent-unknown'), null);
  });

  it('rejects nonexistent config file', () => {
    assert.throws(() => load('/nonexistent/config.yaml'), /not found/);
  });

  it('parses public_jwk as object when provided as object', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-test-'));
    const raw = baseConfig();
    raw.auth.callers.agentbox.public_jwk = { crv: 'Ed25519', x: 'abc', kty: 'OKP', kid: 'def' };
    const configPath = writeConfig(tmpDir, raw);
    const config = load(configPath);
    const caller = getCallerByUid(config, 'agent-test123');
    assert.deepEqual(caller.publicJwk, { crv: 'Ed25519', x: 'abc', kty: 'OKP', kid: 'def' });
  });
});
