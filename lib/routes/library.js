// routes/library.js — Content library listing, detail, and feedback routes
// Registered when features.library is configured

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { sendJSON, readBody, dataPath, getDataDir } = require('../helpers');

const REPORT_CATEGORIES = ['language', 'format', 'broken-link', 'wrong-item', 'other'];

function getLibraryItems(itemsDir, feedbackDir) {
  try {
    const files = fs.readdirSync(itemsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    return files.map(f => {
      try {
        const content = fs.readFileSync(path.join(itemsDir, f), 'utf-8');
        const item = yaml.load(content);
        // Join with feedback (check both active and processed dirs)
        const feedbackFile = (item.id || f.replace(/\.ya?ml$/, '')) + '.feedback.yaml';
        const feedbackPath = path.join(feedbackDir, feedbackFile);
        const processedDir = path.join(feedbackDir, 'processed');
        const processedPath = path.join(processedDir, feedbackFile);
        const activePath = fs.existsSync(feedbackPath) ? feedbackPath
          : fs.existsSync(processedPath) ? processedPath : null;
        let rating = null;
        let reviewed = false;
        if (activePath) {
          reviewed = true;
          const fb = fs.readFileSync(activePath, 'utf-8');
          const match = fb.match(/^rating:\s*(\S+)/m);
          if (match) rating = match[1];
        }
        return {
          id: item.id || f.replace(/\.ya?ml$/, ''),
          title: item.title,
          category: item.category,
          format: item.format,
          source: item.source,
          source_url: item.source_url,
          status: item.status,
          discovered: item.discovered,
          cover_url: (item.metadata && item.metadata.cover_url) || null,
          rating,
          reviewed,
          _file: f,
        };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a, b) => {
      const da = a.discovered ? new Date(a.discovered) : new Date(0);
      const db = b.discovered ? new Date(b.discovered) : new Date(0);
      return db - da;
    });
  } catch {
    return [];
  }
}

function register(routes, config) {
  const libraryConfig = config.features && config.features.library;
  if (!libraryConfig) return;

  // features.library.dataDir is the path *under* the framework data root.
  // With default top-level dataDir "." this resolves to <agentDir>/content/items
  // exactly as before; with dataDir "data" it resolves to <agentDir>/data/content/items.
  const libraryDataDir = (typeof libraryConfig === 'object' && libraryConfig.dataDir) || 'content/items';
  const itemsDir = dataPath(config, libraryDataDir);
  const feedbackDir = dataPath(config, 'input', 'feedback');

  // GET /api/library — list all content items with feedback status
  routes['GET /api/library'] = (req, res) => {
    sendJSON(res, 200, getLibraryItems(itemsDir, feedbackDir));
  };

  // GET /api/library/:id — single item detail with full metadata
  routes['GET /api/library/:id'] = (req, res) => {
    const id = req.params.id;
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      return sendJSON(res, 400, { error: 'Invalid id' });
    }
    // Try both .yaml and .yml
    let filePath = path.join(itemsDir, id + '.yaml');
    if (!fs.existsSync(filePath)) {
      filePath = path.join(itemsDir, id + '.yml');
    }
    if (!fs.existsSync(filePath)) {
      return sendJSON(res, 404, { error: 'Not found' });
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const item = yaml.load(content);
      // Merge feedback (check both active and processed dirs)
      const feedbackFile = id + '.feedback.yaml';
      const feedbackPath = path.join(feedbackDir, feedbackFile);
      const processedDir = path.join(feedbackDir, 'processed');
      const processedPath = path.join(processedDir, feedbackFile);
      const activeFbPath = fs.existsSync(feedbackPath) ? feedbackPath
        : fs.existsSync(processedPath) ? processedPath : null;
      if (activeFbPath) {
        const fbContent = fs.readFileSync(activeFbPath, 'utf-8');
        item.feedback = yaml.load(fbContent);
      }
      sendJSON(res, 200, item);
    } catch {
      sendJSON(res, 500, { error: 'Failed to read item' });
    }
  };

  // POST /api/feedback/library/:id — submit feedback for a content item
  // Follows the same pattern as POST /api/feedback/:filename in outputs.js
  routes['POST /api/feedback/library/:id'] = (req, res) => {
    const id = req.params.id;
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      return sendJSON(res, 400, { error: 'Invalid id' });
    }

    readBody(req).then(body => {
      try {
        const data = JSON.parse(body);
        const ratingStr = data.rating; // "up" or "down"
        if (ratingStr && ratingStr !== 'up' && ratingStr !== 'down') {
          return sendJSON(res, 400, { error: 'Rating must be "up" or "down"' });
        }
        const notes = (data.notes || '').trim();
        if (!ratingStr && !notes) {
          return sendJSON(res, 400, { error: 'Provide a rating and/or notes' });
        }

        if (!fs.existsSync(feedbackDir)) {
          fs.mkdirSync(feedbackDir, { recursive: true });
        }

        const feedbackFile = id + '.feedback.yaml';
        const feedbackPath = path.join(feedbackDir, feedbackFile);
        const now = new Date().toISOString();
        let yamlStr = `item: ${id}\nreviewed_at: ${now}\n`;
        if (ratingStr) yamlStr += `rating: ${ratingStr}\n`;
        if (notes) {
          yamlStr += `notes: |\n${notes.split('\n').map(l => '  ' + l).join('\n')}\n`;
        }
        fs.writeFileSync(feedbackPath, yamlStr);
        sendJSON(res, 200, { ok: true, file: feedbackFile });
      } catch {
        sendJSON(res, 400, { error: 'Invalid JSON' });
      }
    });
  };

  // GET /api/library/recent — items discovered in the last 24 hours
  routes['GET /api/library/recent'] = (req, res) => {
    const items = getLibraryItems(itemsDir, feedbackDir);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = items.filter(item => {
      if (!item.discovered) return false;
      return new Date(item.discovered) > cutoff;
    });
    sendJSON(res, 200, recent);
  };

  // POST /api/feedback/library/:id/report — operator reports a quality/format
  // issue with a library item. Distinct from up/down rating: a report is not
  // a taste signal but a complaint about how the item was delivered
  // (Spanish edition, wrong format, dead link, wrong item, etc.).
  //
  // On submit:
  //   1. Item moves from <data>/content/items/<id>.yaml to
  //      <data>/content/reported/<id>.yaml with a _report: block.
  //   2. A feedback file lands at <data>/input/feedback/<id>.report.yaml so
  //      the agent processes the report on its next cycle.
  routes['POST /api/feedback/library/:id/report'] = (req, res) => {
    const id = req.params.id;
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      return sendJSON(res, 400, { error: 'Invalid id' });
    }

    readBody(req).then(body => {
      let data;
      try { data = JSON.parse(body); }
      catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

      const reason = (data.reason || '').trim();
      if (!reason) {
        return sendJSON(res, 400, { error: 'reason is required' });
      }

      let category = (data.category || 'other').trim().toLowerCase();
      if (!REPORT_CATEGORIES.includes(category)) {
        return sendJSON(res, 400, {
          error: `category must be one of: ${REPORT_CATEGORIES.join(', ')}`,
        });
      }

      // Locate the item file (.yaml or .yml)
      let itemPath = path.join(itemsDir, id + '.yaml');
      if (!fs.existsSync(itemPath)) itemPath = path.join(itemsDir, id + '.yml');
      if (!fs.existsSync(itemPath)) {
        return sendJSON(res, 404, { error: 'Item not found in library' });
      }

      // Load + annotate with _report block
      let item;
      try {
        item = yaml.load(fs.readFileSync(itemPath, 'utf-8'));
      } catch (err) {
        return sendJSON(res, 500, { error: 'Failed to read item: ' + err.message });
      }
      if (!item || typeof item !== 'object') {
        return sendJSON(res, 500, { error: 'Item file is malformed' });
      }

      const now = new Date().toISOString();
      const enriched = {
        ...item,
        _report: { reported_at: now, category, reason },
      };

      // Move into reported/
      const reportedDir = dataPath(config, 'content', 'reported');
      fs.mkdirSync(reportedDir, { recursive: true });
      const reportedPath = path.join(reportedDir, id + '.yaml');
      fs.writeFileSync(reportedPath, yaml.dump(enriched, { lineWidth: -1 }));
      try { fs.unlinkSync(itemPath); } catch {}

      // Drop a feedback file so the agent processes it next cycle
      fs.mkdirSync(feedbackDir, { recursive: true });
      const fbPath = path.join(feedbackDir, id + '.report.yaml');
      const fbYaml = `item: ${id}\nreported_at: ${now}\nreport:\n  category: ${category}\n  reason: |\n${reason.split('\n').map(l => '    ' + l).join('\n')}\n`;
      fs.writeFileSync(fbPath, fbYaml);

      const agentDir = config.agentDir || '.';
      sendJSON(res, 200, {
        ok: true,
        id,
        moved_to: path.relative(agentDir, reportedPath),
        feedback_at: path.relative(agentDir, fbPath),
      });
    });
  };
}

module.exports = { register, getLibraryItems };
