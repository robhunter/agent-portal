// routes/rated-items.js — User-added content ratings (not tied to Library items)
// Schema: memory/rated-items.yaml -> { items: [{ id, category, title, description, rating, created_at, processed_at }] }
// Registered when features.library is configured.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { sendJSON, readBody } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.library) return;

  const agentDir = config.agentDir || '.';
  const file = path.join(agentDir, 'memory', 'rated-items.yaml');

  function read() {
    try {
      const data = yaml.load(fs.readFileSync(file, 'utf-8'));
      return (data && Array.isArray(data.items)) ? data.items : [];
    } catch {
      return [];
    }
  }

  function write(items) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, yaml.dump({ items }, { lineWidth: -1 }));
  }

  function slugify(s) {
    return String(s).toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item';
  }

  function newId(title) {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `rated-${ts}-${slugify(title)}-${rand}`;
  }

  function validateRating(r) {
    return r === 'up' || r === 'down';
  }

  // GET /api/rated-items?category=... — list, optionally filtered. Newest first.
  routes['GET /api/rated-items'] = (req, res, url) => {
    const items = read();
    const category = url && url.searchParams ? url.searchParams.get('category') : null;
    const filtered = category ? items.filter(i => i.category === category) : items;
    const sorted = filtered.slice().sort((a, b) => {
      const ad = a.created_at || '';
      const bd = b.created_at || '';
      return bd.localeCompare(ad);
    });
    sendJSON(res, 200, sorted);
  };

  // POST /api/rated-items — { category, title, description, rating }
  routes['POST /api/rated-items'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.category || typeof body.category !== 'string') {
        return sendJSON(res, 400, { error: 'Category required' });
      }
      if (!body.title || !String(body.title).trim()) {
        return sendJSON(res, 400, { error: 'Title required' });
      }
      if (!validateRating(body.rating)) {
        return sendJSON(res, 400, { error: 'Rating must be "up" or "down"' });
      }
      const items = read();
      const item = {
        id: newId(body.title),
        category: body.category.trim(),
        title: String(body.title).trim(),
        description: body.description ? String(body.description).trim() : '',
        rating: body.rating,
        created_at: new Date().toISOString(),
        processed_at: null,
      };
      items.push(item);
      write(items);
      sendJSON(res, 200, item);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };

  // PUT /api/rated-items — { id, title?, description?, rating?, category? }
  routes['PUT /api/rated-items'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.id) return sendJSON(res, 400, { error: 'id required' });
      const items = read();
      const idx = items.findIndex(i => i.id === body.id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });

      const item = items[idx];
      if (typeof body.title === 'string') {
        if (!body.title.trim()) return sendJSON(res, 400, { error: 'Title cannot be empty' });
        item.title = body.title.trim();
      }
      if (typeof body.description === 'string') {
        item.description = body.description.trim();
      }
      if (typeof body.rating !== 'undefined') {
        if (!validateRating(body.rating)) return sendJSON(res, 400, { error: 'Rating must be "up" or "down"' });
        item.rating = body.rating;
      }
      if (typeof body.category === 'string' && body.category.trim()) {
        item.category = body.category.trim();
      }
      // Edits invalidate prior agent processing — preferences will be re-extracted
      item.processed_at = null;
      write(items);
      sendJSON(res, 200, item);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };

  // DELETE /api/rated-items — { id }
  routes['DELETE /api/rated-items'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.id) return sendJSON(res, 400, { error: 'id required' });
      const items = read();
      const idx = items.findIndex(i => i.id === body.id);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
      items.splice(idx, 1);
      write(items);
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  };
}

module.exports = { register };
