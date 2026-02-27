// routes/requests.js — PM request management
// GET /api/requests — list request files with metadata
// POST /api/requests/reply — reply to a request + cross-post to journal
// Registered when features.requests is true

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody } = require('../helpers');

function register(routes, config) {
  if (!config.features || !config.features.requests) return;

  const agentDir = config.agentDir || '.';
  const requestsDir = path.join(agentDir, 'requests');

  routes['GET /api/requests'] = (req, res) => {
    const requests = [];
    try {
      const files = fs.readdirSync(requestsDir)
        .filter(f => f.endsWith('.md') && f !== '_template.md')
        .sort();
      for (const file of files) {
        const content = fs.readFileSync(path.join(requestsDir, file), 'utf-8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        const statusMatch = content.match(/\*\*Status:\*\*\s*(\w+)/);
        const filedMatch = content.match(/\*\*Filed:\*\*\s*(.+)/);
        requests.push({
          file,
          title: titleMatch ? titleMatch[1].replace(/^Request:\s*/i, '') : file.replace(/\.md$/, ''),
          status: statusMatch ? statusMatch[1] : 'unknown',
          filed: filedMatch ? filedMatch[1].trim() : null,
          content,
        });
      }
    } catch {}
    sendJSON(res, 200, { items: requests });
  };

  routes['POST /api/requests/reply'] = async (req, res) => {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }

    const file = (body.file || '').trim();
    const comment = (body.comment || '').trim();

    if (!file || !comment) {
      return sendJSON(res, 400, { error: 'file and comment are required' });
    }

    // Path traversal protection
    if (file.includes('/') || file.includes('\\') || file.includes('..')) {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }

    const filePath = path.join(requestsDir, file);
    if (!fs.existsSync(filePath)) {
      return sendJSON(res, 404, { error: 'Request file not found' });
    }

    // Read request file to extract title for journal cross-post
    let content = fs.readFileSync(filePath, 'utf-8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].replace(/^Request:\s*/i, '') : file.replace(/\.md$/, '');

    const now = new Date();
    const ts = now.toISOString();

    // Append response to request file
    content += '\n## Response — ' + ts + '\n\n' + comment + '\n';
    fs.writeFileSync(filePath, content);

    // Cross-post to journal
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const filename = `${yyyy}-${mm}.md`;
    const journalsDir = path.join(agentDir, 'journals');
    const journalPath = path.join(journalsDir, filename);
    const journalText = 'Re: ' + title + '\n\n' + comment;
    const entry = `\n### ${ts} | rob | direction\n${journalText}\n`;

    if (!fs.existsSync(journalPath)) {
      const header = `# ${config.name || 'Agent'} Journal — ${yyyy}-${mm}\n\n---\n`;
      fs.writeFileSync(journalPath, header + entry);
    } else {
      fs.appendFileSync(journalPath, entry);
    }

    sendJSON(res, 200, { ok: true, ts });
  };
}

module.exports = { register };
