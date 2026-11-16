// harness-auth.test.js — a recorded login failure reports not logged in until credentials are rewritten.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-auth-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{"tokens":{}}');
  fs.mkdirSync(path.join(root, 'data', 'state'), { recursive: true });
  process.env.HOME = home;
  delete process.env.CODEX_HOME;
  return { root, home, config: { agentDir: root, dataDir: 'data', harness: { type: 'codex' } } };
}

function recordFailure(root, failedAt) {
  fs.writeFileSync(path.join(root, 'data', 'state', 'harness-auth.json'),
    JSON.stringify({ codex: { failedAt, error: 'auth error code: token_revoked' } }));
}

async function status(config) {
  const routes = {};
  require('../lib/routes/harness').register(routes, config);
  let body;
  await routes['GET /api/harness/status']({}, { writeHead() {}, setHeader() {}, end(b) { body = JSON.parse(b); } });
  return body;
}

test('no recorded failure: an existing auth.json reads as logged in', async () => {
  const { config } = setup();
  assert.strictEqual((await status(config)).loggedIn, true);
});

test('a failure newer than the credentials file reads as login failed', async () => {
  const { root, home, config } = setup();
  const credTime = fs.statSync(path.join(home, '.codex', 'auth.json')).mtimeMs / 1000;
  recordFailure(root, credTime + 60);
  const s = await status(config);
  assert.strictEqual(s.loggedIn, false);
  assert.match(s.authError, /token_revoked/);
  assert.ok(s.authFailedAt);
});

test('rewriting the credentials (a new login) clears the failure', async () => {
  const { root, home, config } = setup();
  recordFailure(root, 1000);
  assert.strictEqual((await status(config)).loggedIn, true);
  const auth = path.join(home, '.codex', 'auth.json');
  recordFailure(root, fs.statSync(auth).mtimeMs / 1000 + 60);
  assert.strictEqual((await status(config)).loggedIn, false);
  const later = new Date(Date.now() + 120000);
  fs.utimesSync(auth, later, later);
  assert.strictEqual((await status(config)).loggedIn, true);
});
