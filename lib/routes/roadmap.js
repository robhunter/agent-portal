// routes/roadmap.js — Serves roadmap.md content
// Registered when features.roadmap is true

const fs = require('fs');
const path = require('path');
const { sendJSON } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.roadmap) return;

  const agentDir = config.agentDir || '.';

  routes['GET /api/roadmap'] = (req, res) => {
    const roadmapPath = path.join(agentDir, 'roadmap.md');
    try {
      const content = fs.readFileSync(roadmapPath, 'utf-8');
      sendJSON(res, 200, { content });
    } catch {
      sendJSON(res, 200, { content: '*No roadmap.md found.*' });
    }
  };
}

module.exports = { register };
