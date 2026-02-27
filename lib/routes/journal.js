// routes/journal.js — /api/journal (GET + POST)

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody, getAllJournalEntries } = require('../helpers');

const VALID_TAGS = ['output', 'feedback', 'outcome', 'observation', 'note', 'direction', 'question'];

function register(routes, config) {
  const journalsDir = path.join(config.agentDir, 'journals');

  routes['GET /api/journal'] = (req, res) => {
    const entries = getAllJournalEntries(journalsDir);
    sendJSON(res, 200, { entries });
  };

  routes['POST /api/journal'] = async (req, res) => {
    const body = await readBody(req);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }

    const text = (data.text || '').trim();
    const tag = (data.tag || 'note').trim();

    if (!text) {
      return sendJSON(res, 400, { error: 'Text is required' });
    }
    if (!VALID_TAGS.includes(tag)) {
      return sendJSON(res, 400, { error: 'Invalid tag. Must be one of: ' + VALID_TAGS.join(', ') });
    }

    const now = new Date();
    const ts = now.toISOString();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const filename = `${yyyy}-${mm}.md`;
    const journalPath = path.join(journalsDir, filename);

    const entry = `\n### ${ts} | rob | ${tag}\n\n${text}\n`;

    if (!fs.existsSync(journalPath)) {
      const name = config.name || 'Agent';
      const header = `# ${name} Journal — ${yyyy}-${mm}\n\n---\n`;
      fs.writeFileSync(journalPath, header + entry);
    } else {
      fs.appendFileSync(journalPath, entry);
    }

    sendJSON(res, 200, { ok: true, ts, tag });
  };
}

module.exports = { register };
