// routes/sources.js — Content source management routes
// Registered when features.library is configured

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { sendJSON, readBody, dataPath } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.library) return;

  const sourcesFile = dataPath(config, 'config', 'sources.yaml');
  const credDir = dataPath(config, 'config', 'credentials');

  function readSources() {
    try {
      const content = fs.readFileSync(sourcesFile, 'utf-8');
      const data = yaml.load(content);
      return (data && data.sources) || [];
    } catch {
      return [];
    }
  }

  function writeSources(sources) {
    const dir = path.dirname(sourcesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(sourcesFile, yaml.dump({ sources }, { lineWidth: -1 }));
  }

  // GET /api/sources — list all sources
  routes['GET /api/sources'] = (req, res) => {
    const sources = readSources();
    // Check credentials existence for each source
    const result = sources.map(s => ({
      ...s,
      hasCredentials: fs.existsSync(path.join(credDir, (s.id || '') + '.yaml')),
    }));
    sendJSON(res, 200, result);
  };

  // POST /api/sources/:id/approve — set source status to approved
  routes['POST /api/sources/:id/approve'] = (req, res) => {
    const id = req.params.id;
    const sources = readSources();
    const source = sources.find(s => s.id === id);
    if (!source) return sendJSON(res, 404, { error: 'Source not found' });
    source.status = 'approved';
    writeSources(sources);
    sendJSON(res, 200, { ok: true, id, status: 'approved' });
  };

  // POST /api/sources/:id/deny — set source status to denied
  routes['POST /api/sources/:id/deny'] = (req, res) => {
    const id = req.params.id;
    const sources = readSources();
    const source = sources.find(s => s.id === id);
    if (!source) return sendJSON(res, 404, { error: 'Source not found' });
    source.status = 'denied';
    writeSources(sources);
    sendJSON(res, 200, { ok: true, id, status: 'denied' });
  };
}

module.exports = { register };
