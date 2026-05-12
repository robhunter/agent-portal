// routes/preferences.js — Per-category preference model CRUD routes
// Schema: preferences.<category>.<section>[index] where section is likes/dislikes
// Registered when features.library is configured

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { sendJSON, readBody, dataPath } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.library) return;

  const prefsFile = dataPath(config, 'memory', 'preferences.yaml');

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

  // POST /api/preferences/category-request — submit freeform context for a new category
  // Writes to input/feedback/ for the agent to process on its next cycle
  routes['POST /api/preferences/category-request'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.category || typeof body.category !== 'string') {
        return sendJSON(res, 400, { error: 'Category required' });
      }
      if (!body.context || !body.context.trim()) {
        return sendJSON(res, 400, { error: 'Context required' });
      }

      const feedbackDir = dataPath(config, 'input', 'feedback');
      if (!fs.existsSync(feedbackDir)) fs.mkdirSync(feedbackDir, { recursive: true });

      const category = body.category.trim().toLowerCase().replace(/\s+/g, '-');
      const feedbackFile = path.join(feedbackDir, `category-${category}.feedback.yaml`);
      const now = new Date().toISOString();
      const yamlStr = `type: category-request\ncategory: ${category}\nsubmitted_at: ${now}\ncontext: |\n${body.context.trim().split('\n').map(l => '  ' + l).join('\n')}\n`;
      fs.writeFileSync(feedbackFile, yamlStr);

      // Also ensure the category exists in preferences (empty, for immediate UI)
      const prefs = readPrefs();
      if (!prefs[category]) {
        prefs[category] = { likes: [], dislikes: [] };
        writePrefs(prefs);
      }

      sendJSON(res, 200, { ok: true, category });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };
}

module.exports = { register };
