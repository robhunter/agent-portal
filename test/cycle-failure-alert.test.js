const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { failureRun } = require('../scripts/cycle-failure-alert.js');
const script = path.resolve(__dirname, '../scripts/cycle-failure-alert.js');

function fixture(t, dataDir = '.') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cycle-alert-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, dataDir);
  fs.mkdirSync(path.join(data, 'logs'), { recursive: true });
  const events = path.join(data, 'logs/events.jsonl');
  const state = path.join(data, 'logs/cycle-failure-alert.json');
  const log = path.join(data, 'logs/transcript.log');
  const callsFile = path.join(root, 'calls.jsonl');
  fs.writeFileSync(events, '');
  fs.writeFileSync(log, 'Failed to authenticate: OAuth session expired and could not be refreshed\nsecond line\n');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.ALERT_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');process.exit(Number(process.env.ALERT_CURL_EXIT || 0));\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, TELEGRAM_TOKEN: 'fixture-token', TELEGRAM_CHAT_ID: 'fixture-chat', ALERT_CALLS: callsFile };
  let sequence = 0;
  function cycle(failed, { complete = true, summary = 'Scheduled wake', errors = 1 } = {}) {
    const stamp = new Date(Date.UTC(2026, 9, 25, sequence++)).toISOString();
    const entries = [{ ts: stamp, type: 'cycle_start', summary }];
    if (failed) for (let i = 0; i < errors; i++) entries.push({ ts: stamp, type: 'error', summary: 'Harness exited with code 1 after 2 attempt(s)' });
    if (complete) entries.push({ ts: stamp, type: 'cycle_end', summary: 'Cycle complete' });
    fs.appendFileSync(events, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    return stamp;
  }
  function run(exitCode, now = '2026-10-25T12:00:00Z', extraEnv = {}) {
    const options = { agentDir: root, dataDir, agentName: 'fixture-agent', cycleLog: log, exitCode, now };
    const code = `const m=require(process.argv[1]);const o=JSON.parse(process.argv[2]);o.now=new Date(o.now);m.notifyCycleFailures(o);`;
    return spawnSync(process.execPath, ['-e', code, script, JSON.stringify(options)], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
  }
  const calls = () => fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const messages = () => calls().map(args => args.find(arg => arg.startsWith('text=')).slice(5));
  return { root, data, events, state, log, env, cycle, run, calls, messages };
}

for (const dataDir of ['.', 'state/nested']) {
  test(`successful scheduled cycles add no notification files (${dataDir})`, t => {
    const f = fixture(t, dataDir);
    for (let i = 0; i < 6; i++) f.cycle(false);
    const before = fs.readdirSync(path.join(f.data, 'logs'));
    assert.equal(f.run(0).status, 0);
    assert.deepEqual(fs.readdirSync(path.join(f.data, 'logs')), before);
    assert.deepEqual(f.calls(), []);
  });

  test(`third failure alerts once, throttles for 24 hours, and recovers once (${dataDir})`, t => {
    const f = fixture(t, dataDir);
    const first = f.cycle(true);
    assert.equal(f.run(1).status, 0);
    f.cycle(true);
    assert.equal(f.run(1).status, 0);
    assert.deepEqual(f.calls(), []);
    assert.equal(fs.existsSync(f.state), false);
    f.cycle(true, { complete: false });
    assert.equal(f.run(1).status, 0);
    assert.equal(f.calls().length, 1);
    assert.ok(f.messages()[0].includes('fixture-agent: 3 consecutive scheduled cycles failed.'));
    assert.ok(f.messages()[0].includes(first));
    assert.ok(f.messages()[0].endsWith('Failed to authenticate: OAuth session expired and could not be refreshed'));
    assert.ok(!f.messages()[0].includes('second line'));
    f.cycle(true);
    assert.equal(f.run(1, '2026-10-25T23:59:59Z').status, 0);
    assert.equal(f.run(1, '2026-10-26T00:00:00Z').status, 0);
    assert.equal(f.calls().length, 1);
    assert.equal(f.run(1, '2026-10-26T12:00:00Z').status, 0);
    assert.equal(f.calls().length, 2);
    assert.equal(f.run(1, '2026-10-26T12:00:01Z').status, 0);
    assert.equal(f.calls().length, 2);
    f.cycle(false, { complete: false });
    assert.equal(f.run(0, '2026-10-26T13:00:00Z').status, 0);
    assert.equal(f.calls().length, 3);
    assert.equal(f.messages()[2], 'fixture-agent is running again after its scheduled cycle failures.');
    assert.equal(fs.existsSync(f.state), false);
    f.cycle(false);
    assert.equal(f.run(0).status, 0);
    assert.equal(f.calls().length, 3);
    for (let i = 0; i < 3; i++) f.cycle(true);
    assert.equal(f.run(1, '2026-10-26T14:00:00Z').status, 0);
    assert.equal(f.calls().length, 4);
    assert.notEqual(JSON.parse(fs.readFileSync(f.state)).firstFailure, first);
  });
}

test('attempts and unrelated errors do not count as additional scheduled cycles', t => {
  const f = fixture(t);
  f.cycle(true, { errors: 4 });
  assert.equal(f.run(1).status, 0);
  assert.deepEqual(f.calls(), []);
  f.cycle(false);
  fs.appendFileSync(f.events, '{"type":"error","summary":"git push failed"}\n');
  f.cycle(true);
  f.cycle(true);
  assert.equal(f.run(1).status, 0);
  assert.deepEqual(f.calls(), []);
});

test('respond cycles and incomplete cycles do not turn a failed harness run into a success', t => {
  const f = fixture(t);
  f.cycle(true, { complete: false });
  f.cycle(false, { summary: 'Respond cycle (journal)' });
  f.cycle(false, { complete: false });
  f.cycle(true);
  f.cycle(true, { complete: false });
  assert.equal(f.run(1).status, 0);
  assert.equal(f.calls().length, 1);
  assert.match(f.messages()[0], /3 consecutive/);
});

test('missing Telegram configuration sends nothing and creates no alert state', t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) f.cycle(true);
  for (const variable of ['TELEGRAM_TOKEN', 'TELEGRAM_CHAT_ID']) {
    assert.equal(f.run(1, undefined, { [variable]: '' }).status, 0);
    assert.deepEqual(f.calls(), []);
    assert.equal(fs.existsSync(f.state), false);
  }
  assert.equal(f.run(1).status, 0);
  assert.equal(f.calls().length, 1);
});

test('failed sends remain eligible for alert and recovery retries', t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) f.cycle(true);
  assert.notEqual(f.run(1, undefined, { ALERT_CURL_EXIT: '7' }).status, 0);
  assert.equal(fs.existsSync(f.state), false);
  assert.equal(f.run(1).status, 0);
  assert.equal(f.calls().length, 2);
  const state = fs.readFileSync(f.state, 'utf8');
  f.cycle(false);
  assert.notEqual(f.run(0, undefined, { ALERT_CURL_EXIT: '7' }).status, 0);
  assert.equal(fs.readFileSync(f.state, 'utf8'), state);
  assert.equal(f.run(0).status, 0);
  assert.equal(f.calls().length, 4);
  assert.equal(fs.existsSync(f.state), false);
});

test('the CLI reads the selected transcript, tolerates malformed log lines and missing transcripts', t => {
  const f = fixture(t, 'state/nested');
  f.cycle(true);
  fs.appendFileSync(f.events, 'bad JSON\nnull\n[]\n');
  f.cycle(true);
  f.cycle(true);
  fs.unlinkSync(f.log);
  const result = spawnSync(process.execPath, [script, f.root, 'state/nested', 'cli-agent', f.log, '1'], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.messages()[0], /^cli-agent: 3 consecutive/);
  assert.match(f.messages()[0], /No transcript available/);
});

test('a corrupt prior alert cannot suppress a real third failure', t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) f.cycle(true);
  for (const saved of ['null', 'broken', '{}']) {
    fs.writeFileSync(f.state, saved);
    assert.equal(f.run(1).status, 0);
  }
  assert.equal(f.calls().length, 3);
});

test('completed scheduled successes reset a run, while unrelated events do not', () => {
  const events = [
    { type: 'cycle_start', summary: 'Scheduled wake', ts: 'first' },
    { type: 'error', summary: 'Harness exited with code 1 after 2 attempt(s)', ts: 'first failure' },
    { type: 'cycle_end' },
    { type: 'cycle_start', summary: 'Scheduled wake', ts: 'success' },
    { type: 'cycle_end' },
    { type: 'cycle_start', summary: 'Scheduled wake', ts: 'latest' },
    { type: 'error', summary: 'git push failed' },
  ];
  assert.deepEqual(failureRun(events, 1), { count: 1, firstFailure: 'latest' });
});
