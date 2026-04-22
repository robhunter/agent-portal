// routes/harness.js — /api/harness/status
// Replaces routes/claude.js with harness-agnostic auth status checking.
// Branches on config.harness.type: claude-code, letta-code, script.

const { execSync } = require('child_process');
const http = require('http');
const https = require('https');
const { sendJSON } = require('../helpers');

function checkClaudeCode(req, res) {
  try {
    const output = execSync('claude auth status --json', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const status = JSON.parse(output);
    sendJSON(res, 200, status);
  } catch {
    sendJSON(res, 200, { loggedIn: false });
  }
}

function checkLettaCode(req, res, config) {
  const baseUrl = process.env.LETTA_BASE_URL || 'https://app.letta.com';
  const healthUrl = baseUrl.replace(/\/$/, '') + '/api/health';
  const client = healthUrl.startsWith('https') ? https : http;
  const request = client.get(healthUrl, { timeout: 5000 }, (response) => {
    sendJSON(res, 200, { loggedIn: response.statusCode >= 200 && response.statusCode < 400, harnessType: 'letta-code' });
    response.resume(); // drain the response
  });
  request.on('error', () => {
    sendJSON(res, 200, { loggedIn: false, harnessType: 'letta-code' });
  });
  request.on('timeout', () => {
    request.destroy();
    sendJSON(res, 200, { loggedIn: false, harnessType: 'letta-code' });
  });
}

function register(routes, config) {
  const harnessType = (config.harness && config.harness.type) || 'claude-code';

  routes['GET /api/harness/status'] = (req, res) => {
    switch (harnessType) {
      case 'letta-code':
        return checkLettaCode(req, res, config);
      case 'script':
        return sendJSON(res, 200, { loggedIn: true, harnessType: 'script' });
      case 'claude-code':
      default:
        return checkClaudeCode(req, res);
    }
  };

  // Backward compatibility: keep /api/claude/status as alias
  routes['GET /api/claude/status'] = routes['GET /api/harness/status'];
}

module.exports = { register };
