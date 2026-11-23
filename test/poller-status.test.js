// poller-status.test.js — what /api/status and the sidebar say about the work
// poller (scripts/poller.sh).

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('node:vm');

const { readPollerStatus } = require('../lib/routes/status');
const { getClientCore } = require('../lib/ui/client-core');

describe('readPollerStatus', () => {
  let dir, logs;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poller-status-'));
    logs = path.join(dir, 'logs');
    fs.mkdirSync(logs);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const yamlWith = (body) => fs.writeFileSync(path.join(dir, 'agent.yaml'), 'name: t\n' + body);
  const statusFile = (doc) => fs.writeFileSync(path.join(logs, 'poller-status.json'), JSON.stringify(doc));

  it('is null when agent.yaml configures no poller, even with a leftover status file', () => {
    yamlWith('');
    statusFile({ checkedAt: new Date().toISOString(), intervalSeconds: 60 });
    assert.equal(readPollerStatus(dir, logs), null);
  });

  it('is null when agent.yaml is missing', () => {
    assert.equal(readPollerStatus(dir, logs), null);
  });

  it('reports a configured poller that has never ticked as not running', () => {
    yamlWith('poll:\n  command: echo hi\n');
    const p = readPollerStatus(dir, logs);
    assert.equal(p.command, 'echo hi');
    assert.equal(p.running, false);
    assert.equal(p.stale, true);
  });

  it('passes a fresh tick through as running', () => {
    yamlWith('poll:\n  command: echo hi\n');
    statusFile({ checkedAt: new Date().toISOString(), intervalSeconds: 60, enabled: true, ok: true, due: ['a'], dueCount: 1, pid: 42 });
    const p = readPollerStatus(dir, logs);
    assert.equal(p.running, true);
    assert.equal(p.stale, false);
    assert.equal(p.dueCount, 1);
    assert.deepEqual(p.due, ['a']);
  });

  it('calls a tick older than three intervals plus the command timeout stale', () => {
    yamlWith('poll:\n  command: echo hi\n');
    statusFile({ checkedAt: new Date(Date.now() - 600 * 1000).toISOString(), intervalSeconds: 60, enabled: true, ok: true });
    const p = readPollerStatus(dir, logs);
    assert.equal(p.stale, true);
    assert.equal(p.running, false);
  });
});

describe('sidebar pollStatusText', () => {
  const sandbox = {
    window: { fetch: () => {} },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, createElement: () => ({ style: {}, classList: {}, addEventListener: () => {} }), body: { style: {}, addEventListener: () => {} } },
    performance: { now: () => 0, getEntriesByType: () => [] },
    localStorage: { getItem: () => null, setItem: () => {} },
    PORTAL_CONFIG: { tabs: ['journal'] },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(getClientCore() + '\nglobalThis.pollStatusText = pollStatusText;', sandbox, { timeout: 5000 });
  const text = sandbox.pollStatusText;

  it('hides the line when there is no poller', () => {
    assert.equal(text(null), null);
  });

  it('says how much is due and when it last checked', () => {
    const st = text({ running: true, stale: false, enabled: true, ok: true, dueCount: 2, due: ['item:1', 'pr:2'], ageSeconds: 12, intervalSeconds: 60, command: 'x' });
    assert.equal(st.text, 'Polling: 2 due · checked 12s ago');
    assert.match(st.title, /item:1\npr:2/);
  });

  it('says nothing is due on an empty set', () => {
    assert.match(text({ stale: false, enabled: true, ok: true, dueCount: 0, ageSeconds: 5, intervalSeconds: 60 }).text, /^Polling: nothing due/);
  });

  it('flags a dead loop, a paused one, and a failing command differently', () => {
    assert.equal(text({ stale: true }).text, 'Polling: not running');
    assert.equal(text({ stale: false, enabled: false }).text, 'Polling: off (cron disabled)');
    const err = text({ stale: false, enabled: true, ok: false, error: 'poll command failed (rc=1): boom' });
    assert.equal(err.text, 'Polling: error');
    assert.match(err.title, /boom/);
  });
});
