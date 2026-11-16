// routes/harness.js — /api/harness/status
// Checks every harness in config.harness.types (or the single config.harness.type):
// claude-code, codex, letta-code, script. Also reports which one the next cycle
// runs (see lib/harness-select.js).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { sendJSON, dataPath } = require('../helpers');
const { harnessTypes, defaultType, selectedType, isSwitchable } = require('../harness-select');

function credentialsPath(type) {
  const home = process.env.HOME || '/root';
  if (type === 'codex') return path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'auth.json');
  if (type === 'claude-code') return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), '.credentials.json');
  return null;
}

// A failure recorded by scripts/harness-auth.py, unless the credentials file was written since.
function authFailure(config, type) {
  let entry;
  try {
    entry = JSON.parse(fs.readFileSync(dataPath(config, 'state', 'harness-auth.json'), 'utf-8'))[type];
  } catch { return null; }
  if (!entry || typeof entry.failedAt !== 'number') return null;
  try {
    if (fs.statSync(credentialsPath(type)).mtimeMs / 1000 > entry.failedAt) return null;
  } catch {}
  return { at: new Date(entry.failedAt * 1000).toISOString(), error: entry.error };
}

function withFailure(result, config, type) {
  const failure = authFailure(config, type);
  if (!failure) return result;
  return { ...result, loggedIn: false, authError: failure.error, authFailedAt: failure.at };
}

function checkClaudeCode(config) {
  let result;
  try {
    const output = execSync('claude auth status --json', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    result = JSON.parse(output);
  } catch {
    result = { loggedIn: false };
  }
  return withFailure(result, config, 'claude-code');
}

function checkCodex(config) {
  let loggedIn = false;
  try {
    loggedIn = fs.statSync(credentialsPath('codex')).size > 0;
  } catch {}
  return withFailure({ loggedIn, harnessType: 'codex' }, config, 'codex');
}

function checkLettaCode() {
  return new Promise((resolve) => {
    const baseUrl = process.env.LETTA_BASE_URL || 'https://app.letta.com';
    const healthUrl = baseUrl.replace(/\/$/, '') + '/api/health';
    const client = healthUrl.startsWith('https') ? https : http;
    const request = client.get(healthUrl, { timeout: 5000 }, (response) => {
      resolve({ loggedIn: response.statusCode >= 200 && response.statusCode < 400, harnessType: 'letta-code' });
      response.resume();
    });
    request.on('error', () => resolve({ loggedIn: false, harnessType: 'letta-code' }));
    request.on('timeout', () => {
      request.destroy();
      resolve({ loggedIn: false, harnessType: 'letta-code' });
    });
  });
}

function checkHarness(type, config) {
  switch (type) {
    case 'letta-code':
      return checkLettaCode();
    case 'codex':
      return checkCodex(config);
    case 'script':
      return { loggedIn: true, harnessType: 'script' };
    case 'claude-code':
    default:
      return checkClaudeCode(config);
  }
}

function register(routes, config) {
  const types = harnessTypes(config);

  routes['GET /api/harness/status'] = async (req, res) => {
    // Read per request: the override file changes without a portal restart.
    const selection = {
      selected: selectedType(config),
      defaultType: defaultType(config),
      switchable: isSwitchable(config),
    };
    if (types.length === 1) {
      return sendJSON(res, 200, { ...(await checkHarness(types[0], config)), ...selection });
    }
    const results = await Promise.all(types.map(t => checkHarness(t, config)));
    sendJSON(res, 200, {
      loggedIn: results.every(r => r.loggedIn),
      harnessType: 'multi',
      harnesses: types.map((type, i) => ({
        type, loggedIn: !!results[i].loggedIn,
        ...(results[i].authError ? { authError: results[i].authError, authFailedAt: results[i].authFailedAt } : {}),
      })),
      ...selection,
    });
  };

  // Backward compatibility: keep /api/claude/status as alias
  routes['GET /api/claude/status'] = routes['GET /api/harness/status'];
}

module.exports = { register, harnessTypes, authFailure };
