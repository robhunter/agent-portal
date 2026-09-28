// helpers.js — Shared utility functions for the agent portal
// No external dependencies — uses Node built-in modules only

const fs = require('fs');
const path = require('path');

/**
 * Return the configured data directory, defaulting to '.' for backwards compat.
 * The data directory is where framework-managed mutable state lives
 * (logs/, journals/, memory/, content/, config/, input/, output/, uploads/, etc.).
 * Operator-owned files (CLAUDE.md, agent.yaml, today.md, roadmap.md, scripts/,
 * skills/, tools/, .mcp.json) stay at the agent root regardless of this setting.
 */
function getDataDir(config) {
  return (config && config.dataDir) || '.';
}

/**
 * Resolve a data path relative to <agentDir>/<dataDir>.
 * Routes and helpers that touch framework-managed state should use this
 * instead of path.join(config.agentDir, ...). Operator-owned root paths
 * (today.md, roadmap.md, agent.yaml, .mcp.json, tools/, skills/) should
 * continue to use path.join(config.agentDir, ...) directly.
 */
function dataPath(config, ...parts) {
  const agentDir = (config && config.agentDir) || '.';
  return path.join(agentDir, getDataDir(config), ...parts);
}

/**
 * Send a JSON response with the given status code and data.
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Read the full request body as a string.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Read the last N lines from a file. Returns an empty array if the file
 * doesn't exist or is empty.
 */
function readLastLines(filePath, n) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];
    const lines = content.split('\n');
    return lines.slice(-n);
  } catch {
    return [];
  }
}

const JOURNAL_HEADER = /^(\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*$/;

/**
 * Find every entry header in a journal file with its byte span. An entry runs
 * from its `### <ts> | <author> | <tag>` line to the next such line, so a `### `
 * subheading inside an entry stays part of that entry. Text before the first
 * header is the file's preamble and belongs to no entry.
 */
function journalEntrySpans(content) {
  const spans = [];
  const headerLine = /^### (.*)$/gm;
  let line;
  while ((line = headerLine.exec(content))) {
    const match = line[1].trim().match(JOURNAL_HEADER);
    if (!match) continue;
    const lineEnd = line.index + line[0].length;
    spans.push({
      ts: match[1],
      author: match[2],
      tag: match[3],
      start: line.index,
      bodyStart: content[lineEnd] === '\n' ? lineEnd + 1 : lineEnd,
    });
  }
  spans.forEach((span, i) => { span.end = i + 1 < spans.length ? spans[i + 1].start : content.length; });
  return spans;
}

/**
 * Parse a journal markdown file into structured entries.
 * Journals use the format: ### <ISO timestamp> | <author> | <tag>
 * followed by the entry body. A `### ` line that is not an entry header is a
 * subheading inside the entry above it and is kept in that entry's content.
 */
function parseJournal(content) {
  return journalEntrySpans(content).map(span => ({
    ts: span.ts,
    author: span.author,
    tag: span.tag,
    content: content.slice(span.bodyStart, span.end).trim(),
  }));
}

/**
 * Read all monthly journal files (YYYY-MM.md) from a directory and return
 * combined entries sorted by timestamp.
 */
function getAllJournalEntries(journalsDir, maxMonths) {
  const allEntries = [];
  try {
    const files = fs.readdirSync(journalsDir)
      .filter(f => /^\d{4}-\d{2}\.md$/.test(f))
      .sort();
    // If maxMonths specified, only read the most recent N months for performance
    const filesToRead = maxMonths ? files.slice(-maxMonths) : files;
    for (const file of filesToRead) {
      const content = fs.readFileSync(path.join(journalsDir, file), 'utf-8');
      const entries = parseJournal(content);
      allEntries.push(...entries);
    }
  } catch {}
  allEntries.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return allEntries;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns an object of key-value pairs. Bracket-delimited values
 * (e.g., [tag1, tag2]) are converted to arrays.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.+)$/);
    if (kv) {
      let val = kv[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim());
      }
      fm[kv[1]] = val;
    }
  }
  return fm;
}

/**
 * Edit a journal entry in a markdown file by timestamp.
 * Finds the entry matching `ts`, replaces its content and tag, and rewrites
 * only that entry's span: every other byte of the file stays as it was, and so
 * do the blank lines around the edited entry's text.
 * Returns true if found and updated, false otherwise.
 */
function editJournalEntry(filePath, ts, newText, newTag) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8');

  const span = journalEntrySpans(content).find(e => e.ts === ts);
  if (!span) return false;

  const headerEnd = span.bodyStart;
  const header = newTag === span.tag
    ? content.slice(span.start, headerEnd)
    : `### ${span.ts} | ${span.author} | ${newTag}\n`;
  const body = content.slice(span.bodyStart, span.end);
  const text = body.trim();
  const before = text ? body.slice(0, body.indexOf(text)) : '';
  const after = text ? body.slice(body.indexOf(text) + text.length) : body;

  fs.writeFileSync(filePath, content.slice(0, span.start) + header + before + newText + after + content.slice(span.end));
  return true;
}

module.exports = { sendJSON, readBody, readLastLines, parseJournal, getAllJournalEntries, parseFrontmatter, editJournalEntry, getDataDir, dataPath };
