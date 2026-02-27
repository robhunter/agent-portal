// routes/events.js — /api/events, /api/wins

const fs = require('fs');
const path = require('path');
const { sendJSON, readLastLines } = require('../helpers');

function register(routes, config) {
  const logsDir = path.join(config.agentDir, 'logs');

  routes['GET /api/events'] = (req, res) => {
    const lines = readLastLines(path.join(logsDir, 'events.jsonl'), 50);
    const events = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch {}
    }
    sendJSON(res, 200, events);
  };

  routes['GET /api/wins'] = (req, res) => {
    const winsPath = path.join(logsDir, 'wins.jsonl');
    let allWins = [];
    try {
      const content = fs.readFileSync(winsPath, 'utf-8').trim();
      if (content) {
        const lines = content.split('\n');
        for (const line of lines) {
          try { allWins.push(JSON.parse(line)); } catch {}
        }
      }
    } catch {}
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recent = allWins.filter(w => w.ts >= thirtyDaysAgo);
    sendJSON(res, 200, recent);
  };
}

module.exports = { register };
