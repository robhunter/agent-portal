// routes/health.js — Serves health check data from health.jsonl
// Registered when features.health is true

const { sendJSON, readLastLines, dataPath } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.health) return;

  routes['GET /api/health'] = (req, res) => {
    const lines = readLastLines(dataPath(config, 'logs', 'health.jsonl'), 50);
    const entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch {}
    }
    sendJSON(res, 200, entries);
  };
}

module.exports = { register };
