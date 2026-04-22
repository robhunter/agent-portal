// routes/preferences.js — Preference model CRUD routes
// Follows the same pattern as todos.js (read/write structured YAML by index)
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
      return (data && data.preferences) || { likes: [], dislikes: [], notes: [] };
    } catch {
      return { likes: [], dislikes: [], notes: [] };
    }
  }

  function writePrefs(prefs) {
    const dir = path.dirname(prefsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(prefsFile, yaml.dump({ preferences: prefs }, { lineWidth: -1 }));
  }

  const validSections = ['likes', 'dislikes', 'notes'];

  // GET /api/preferences — return the preference model
  routes['GET /api/preferences'] = (req, res) => {
    sendJSON(res, 200, readPrefs());
  };

  // POST /api/preferences — add a new entry to a section
  routes['POST /api/preferences'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.section || !validSections.includes(body.section)) {
        return sendJSON(res, 400, { error: 'Invalid section (likes, dislikes, notes)' });
      }
      if (!body.text || !body.text.trim()) {
        return sendJSON(res, 400, { error: 'Text required' });
      }

      const prefs = readPrefs();
      if (!prefs[body.section]) prefs[body.section] = [];
      prefs[body.section].push({ text: body.text.trim(), source: 'user' });
      writePrefs(prefs);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };

  // PUT /api/preferences — update an entry by index
  routes['PUT /api/preferences'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.section || !validSections.includes(body.section)) {
        return sendJSON(res, 400, { error: 'Invalid section' });
      }

      const prefs = readPrefs();
      const section = prefs[body.section] || [];
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

  // DELETE /api/preferences — remove an entry by index
  routes['DELETE /api/preferences'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.section || !validSections.includes(body.section)) {
        return sendJSON(res, 400, { error: 'Invalid section' });
      }

      const prefs = readPrefs();
      const section = prefs[body.section] || [];
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
