// routes/journal.js — /api/journal (GET + POST)

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody, getAllJournalEntries, editJournalEntry } = require('../helpers');

const VALID_TAGS = ['output', 'feedback', 'outcome', 'observation', 'note', 'direction', 'question'];

function register(routes, config) {
  const journalsDir = path.join(config.agentDir, 'journals');

  routes['GET /api/journal'] = (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 0, 200);
    const before = url.searchParams.get('before') || '';
    const after = url.searchParams.get('after') || '';

    // Read only last 3 months by default for performance (cache + TTL handles the rest)
    const allEntries = getAllJournalEntries(journalsDir, limit ? undefined : 3);

    if (after) {
      const afterDate = new Date(after);
      const newEntries = allEntries.filter(e => new Date(e.ts) > afterDate);
      return sendJSON(res, 200, { entries: newEntries, hasMore: false });
    }

    if (!limit) {
      // Default to last 100 entries for performance — clients can request more
      const defaultEntries = allEntries.slice(-100);
      return sendJSON(res, 200, { entries: defaultEntries, hasMore: allEntries.length > 100 });
    }

    // Filter entries before the cursor, then take the last `limit` entries
    let filtered = before
      ? allEntries.filter(e => new Date(e.ts) < new Date(before))
      : allEntries;
    const hasMore = filtered.length > limit;
    const entries = filtered.slice(-limit);
    sendJSON(res, 200, { entries, hasMore });
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

  routes['PUT /api/journal'] = async (req, res) => {
    const body = await readBody(req);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }

    const ts = (data.ts || '').trim();
    const text = (data.text || '').trim();
    const tag = (data.tag || '').trim();

    if (!ts) return sendJSON(res, 400, { error: 'ts is required' });
    if (!text) return sendJSON(res, 400, { error: 'text is required' });
    if (!tag || !VALID_TAGS.includes(tag)) {
      return sendJSON(res, 400, { error: 'Invalid tag. Must be one of: ' + VALID_TAGS.join(', ') });
    }

    // Determine which journal file contains this entry by parsing the timestamp
    const d = new Date(ts);
    if (isNaN(d.getTime())) return sendJSON(res, 400, { error: 'Invalid timestamp' });

    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const filename = `${yyyy}-${mm}.md`;
    const journalPath = path.join(journalsDir, filename);

    if (!editJournalEntry(journalPath, ts, text, tag)) {
      return sendJSON(res, 404, { error: 'Entry not found' });
    }

    sendJSON(res, 200, { ok: true, ts, tag });
  };
}

module.exports = { register };
