// routes/claude.js — /api/claude/status

const { execSync } = require('child_process');
const { sendJSON } = require('../helpers');

function register(routes) {
  routes['GET /api/claude/status'] = (req, res) => {
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
  };
}

module.exports = { register };
