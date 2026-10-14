// routes/harness.js — /api/harness/status
// Checks every harness in config.harness.types (or the single config.harness.type):
// claude-code, codex, letta-code, script. Also reports which one the next cycle
// runs (see lib/harness-select.js).

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { sendJSON } = require('../helpers');
const { harnessTypes, defaultType, selectedType, isSwitchable } = require('../harness-select');

function checkClaudeCode() {
  try {
    const output = execSync('claude auth status --json', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return JSON.parse(output);
  } catch {
    return { loggedIn: false };
  }
}

function checkCodex() {
  const home = process.env.CODEX_HOME || path.join(process.env.HOME || '/root', '.codex');
  let loggedIn = false;
  try {
    loggedIn = fs.statSync(path.join(home, 'auth.json')).size > 0;
  } catch {}
  return { loggedIn, harnessType: 'codex' };
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

function checkHarness(type) {
  switch (type) {
    case 'letta-code':
      return checkLettaCode();
    case 'codex':
      return checkCodex();
    case 'script':
      return { loggedIn: true, harnessType: 'script' };
    case 'claude-code':
    default:
      return checkClaudeCode();
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
      return sendJSON(res, 200, { ...(await checkHarness(types[0])), ...selection });
    }
    const results = await Promise.all(types.map(checkHarness));
    sendJSON(res, 200, {
      loggedIn: results.every(r => r.loggedIn),
      harnessType: 'multi',
      harnesses: types.map((type, i) => ({ type, loggedIn: !!results[i].loggedIn })),
      ...selection,
    });
  };

  // Backward compatibility: keep /api/claude/status as alias
  routes['GET /api/claude/status'] = routes['GET /api/harness/status'];
}

module.exports = { register, harnessTypes };
