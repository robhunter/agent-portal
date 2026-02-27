// routes/health.js — Serves health check data from health.jsonl
// Registered when features.health is true

const path = require('path');
const { sendJSON, readLastLines } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.health) return;

  const agentDir = config.agentDir || '.';

  routes['GET /api/health'] = (req, res) => {
    const lines = readLastLines(path.join(agentDir, 'logs', 'health.jsonl'), 50);
    const entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch {}
    }
    sendJSON(res, 200, entries);
  };
}

module.exports = { register };
