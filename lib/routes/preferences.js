// routes/preferences.js — Per-category preference model CRUD routes
// Schema: preferences.<category>.<section>[index] where section is likes/dislikes
// Registered when features.library is configured

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { sendJSON, readBody } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.library) return;

  const agentDir = config.agentDir || '.';
  const prefsFile = path.join(agentDir, 'memory', 'preferences.yaml');

  function readPrefs() {
    try {
      const content = fs.readFileSync(prefsFile, 'utf-8');
      const data = yaml.load(content);
      return (data && data.preferences) || {};
    } catch {
      return {};
    }
  }

  function writePrefs(prefs) {
    const dir = path.dirname(prefsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(prefsFile, yaml.dump({ preferences: prefs }, { lineWidth: -1 }));
  }

  const validSections = ['likes', 'dislikes'];

  function validateBody(body) {
    if (!body.category || typeof body.category !== 'string') {
      return 'Category required';
    }
    if (!body.section || !validSections.includes(body.section)) {
      return 'Invalid section (likes, dislikes)';
    }
    return null;
  }

  function ensureCategory(prefs, category) {
    if (!prefs[category]) prefs[category] = { likes: [], dislikes: [] };
    if (!prefs[category].likes) prefs[category].likes = [];
    if (!prefs[category].dislikes) prefs[category].dislikes = [];
    return prefs[category];
  }

  // GET /api/preferences — return the full preference model (all categories)
  routes['GET /api/preferences'] = (req, res) => {
    sendJSON(res, 200, readPrefs());
  };

  // POST /api/preferences — add a new entry to a category section
  routes['POST /api/preferences'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      const err = validateBody(body);
      if (err) return sendJSON(res, 400, { error: err });
      if (!body.text || !body.text.trim()) {
        return sendJSON(res, 400, { error: 'Text required' });
      }

      const prefs = readPrefs();
      const cat = ensureCategory(prefs, body.category);
      cat[body.section].push({ text: body.text.trim(), source: 'user' });
      writePrefs(prefs);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };

  // PUT /api/preferences — update an entry by category + section + index
  routes['PUT /api/preferences'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      const err = validateBody(body);
      if (err) return sendJSON(res, 400, { error: err });

      const prefs = readPrefs();
      const cat = prefs[body.category];
      if (!cat) return sendJSON(res, 400, { error: 'Category not found' });
      const section = cat[body.section] || [];
      if (typeof body.index !== 'number' || body.index < 0 || body.index >= section.length) {
        return sendJSON(res, 400, { error: 'Invalid index' });
      }
      if (!body.text || !body.text.trim()) {
        return sendJSON(res, 400, { error: 'Text required' });
      }

      section[body.index].text = body.text.trim();
      writePrefs(prefs);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };

  // DELETE /api/preferences — remove an entry by category + section + index
  routes['DELETE /api/preferences'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      const err = validateBody(body);
      if (err) return sendJSON(res, 400, { error: err });

      const prefs = readPrefs();
      const cat = prefs[body.category];
      if (!cat) return sendJSON(res, 400, { error: 'Category not found' });
      const section = cat[body.section] || [];
      if (typeof body.index !== 'number' || body.index < 0 || body.index >= section.length) {
        return sendJSON(res, 400, { error: 'Invalid index' });
      }

      section.splice(body.index, 1);
      writePrefs(prefs);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };
}

module.exports = { register };
