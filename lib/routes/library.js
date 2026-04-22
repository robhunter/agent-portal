// routes/library.js — Content library listing, detail, and feedback routes
// Registered when features.library is configured

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { sendJSON, readBody } = require('../helpers');

function getLibraryItems(agentDir, dataDir) {
  const itemsDir = path.join(agentDir, dataDir);
  const feedbackDir = path.join(agentDir, 'input', 'feedback');
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

  const agentDir = config.agentDir || '.';
  const dataDir = (typeof libraryConfig === 'object' && libraryConfig.dataDir) || 'content/items';
  const feedbackDir = path.join(agentDir, 'input', 'feedback');

  // GET /api/library — list all content items with feedback status
  routes['GET /api/library'] = (req, res) => {
    sendJSON(res, 200, getLibraryItems(agentDir, dataDir));
  };

  // GET /api/library/:id — single item detail with full metadata
  routes['GET /api/library/:id'] = (req, res) => {
    const id = req.params.id;
    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      return sendJSON(res, 400, { error: 'Invalid id' });
    }
    const itemsDir = path.join(agentDir, dataDir);
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
    const items = getLibraryItems(agentDir, dataDir);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = items.filter(item => {
      if (!item.discovered) return false;
      return new Date(item.discovered) > cutoff;
    });
    sendJSON(res, 200, recent);
  };
}

module.exports = { register, getLibraryItems };
