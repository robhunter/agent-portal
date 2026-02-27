// helpers.js — Shared utility functions for the agent portal
// No external dependencies — uses Node built-in modules only

const fs = require('fs');
const path = require('path');

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

/**
 * Parse a journal markdown file into structured entries.
 * Journals use the format: ### <ISO timestamp> | <author> | <tag>
 * followed by the entry body.
 */
function parseJournal(content) {
  const entries = [];
  const parts = content.split(/^### /m);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const firstNewline = part.indexOf('\n');
    if (firstNewline === -1) continue;
    const header = part.substring(0, firstNewline).trim();
    const body = part.substring(firstNewline + 1).trim();
    const headerMatch = header.match(/^(\S+)\s*\|\s*(\w+)\s*\|\s*(\w+)/);
    if (headerMatch) {
      entries.push({
        ts: headerMatch[1],
        author: headerMatch[2],
        tag: headerMatch[3],
        content: body,
      });
    }
  }
  return entries;
}

/**
 * Read all monthly journal files (YYYY-MM.md) from a directory and return
 * combined entries sorted by timestamp.
 */
function getAllJournalEntries(journalsDir) {
  const allEntries = [];
  try {
    const files = fs.readdirSync(journalsDir)
      .filter(f => /^\d{4}-\d{2}\.md$/.test(f))
      .sort();
    for (const file of files) {
      const content = fs.readFileSync(path.join(journalsDir, file), 'utf-8');
      const entries = parseJournal(content);
      allEntries.push(...entries);
    }
  } catch {}
  allEntries.sort((a, b) => a.ts.localeCompare(b.ts));
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

module.exports = { sendJSON, readBody, readLastLines, parseJournal, getAllJournalEntries, parseFrontmatter };
