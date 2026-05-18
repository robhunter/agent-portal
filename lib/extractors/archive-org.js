// extractors/archive-org.js — Generic Archive.org metadata extractor.
//
// Given an Archive.org `details` URL, fetches the public metadata API and
// returns structured facts about the item. No agent-specific or user-specific
// rules live here — extractors only report what the page says. Tenant
// preference enforcement happens in lib/preference-checker.js.
//
// Reusable across any category that consumes Archive.org (comics today,
// audiobooks and books later — same site, same extractor).
//
// Public API: extract(url, opts) -> Promise<facts | { _error }>.

const https = require('https');
const { URL } = require('url');

const METADATA_API = 'https://archive.org/metadata/';
const DEFAULTS = {
  fetchTimeoutMs: 10000,
  userAgent: 'agent-portal-publish-validator/1.0',
};

// Map Archive.org file `format` strings to lowercase extension tokens we can
// compare against preference constraints. Substring match; case-insensitive.
const FORMAT_TOKEN_RULES = [
  { token: 'cbz', match: /comic book zip|^cbz$|\.cbz$/i },
  { token: 'cbr', match: /comic book rar|^cbr$|\.cbr$/i },
  { token: 'pdf', match: /text pdf|^pdf$|\.pdf$/i },
  { token: 'epub', match: /^epub$|\.epub$/i },
  { token: 'mp3', match: /vbr mp3|mp3/i },
  { token: 'mp4', match: /mpeg-?4|mp4/i },
];

function extractArchiveOrgId(sourceUrl) {
  try {
    const u = new URL(sourceUrl);
    if (!/^archive\.org$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/details\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function fetchJson(url, opts) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(url); }
    catch { return resolve({ _error: `invalid URL: ${url}` }); }

    const req = https.request(parsed, {
      method: 'GET',
      headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' },
      timeout: opts.fetchTimeoutMs,
    }, res => {
      const status = res.statusCode;
      if (status < 200 || status >= 300) {
        res.resume();
        return resolve({ _error: `HTTP ${status} from ${url}` });
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve(JSON.parse(body)); }
        catch (e) { resolve({ _error: `JSON parse failed: ${e.message}` }); }
      });
    });
    req.on('error', err => resolve({ _error: err.code || err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ _error: 'timeout' }); });
    req.end();
  });
}

function normaliseLanguage(lang) {
  if (lang == null) return null;
  if (Array.isArray(lang)) lang = lang[0];
  if (typeof lang !== 'string') return null;
  return lang.trim().toLowerCase() || null;
}

function normaliseYear(year, date) {
  for (const v of [year, date]) {
    if (v == null) continue;
    const s = String(v);
    const m = s.match(/(\d{4})/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function tokeniseFormats(files) {
  if (!Array.isArray(files)) return [];
  const tokens = new Set();
  for (const f of files) {
    const fmt = (f && f.format) || '';
    const name = (f && f.name) || '';
    for (const rule of FORMAT_TOKEN_RULES) {
      if (rule.match.test(fmt) || rule.match.test(name)) {
        tokens.add(rule.token);
      }
    }
  }
  return [...tokens];
}

function detectBorrowableOnly(raw, formats) {
  // Heuristic: Archive.org "borrowable" items are flagged either explicitly
  // (`access-restricted-item: true`) or implicitly (no freely-downloadable
  // file formats present — only ACS-encrypted PDFs/EPUBs).
  const meta = raw.metadata || {};
  const restricted = String(meta['access-restricted-item'] || '').toLowerCase() === 'true';
  const freelyDownloadable = formats.length > 0;
  return restricted || !freelyDownloadable;
}

/**
 * Extract structured facts for an Archive.org item.
 * @param {string} sourceUrl — any Archive.org URL (`/details/<id>` form expected).
 * @param {object} opts — { fetchTimeoutMs?, userAgent? }
 * @returns {Promise<{
 *   identifier: string,
 *   language: string | null,
 *   available_formats: string[],
 *   borrowable_only: boolean,
 *   title: string | null,
 *   creator: string | null,
 *   year: number | null,
 *   thumbnail_url: string | null,
 *   raw_metadata: object,
 * } | { _error: string }>}
 */
async function extract(sourceUrl, opts = {}) {
  const identifier = extractArchiveOrgId(sourceUrl);
  if (!identifier) {
    return { _error: `not an archive.org details URL: ${sourceUrl}` };
  }

  const definedOpts = Object.fromEntries(
    Object.entries(opts).filter(([, v]) => v !== undefined)
  );
  const merged = { ...DEFAULTS, ...definedOpts };

  const raw = await fetchJson(METADATA_API + encodeURIComponent(identifier), merged);
  if (raw._error) return { _error: raw._error };

  const meta = raw.metadata || {};
  const files = raw.files || [];
  const formats = tokeniseFormats(files);

  return {
    identifier,
    language: normaliseLanguage(meta.language),
    available_formats: formats,
    borrowable_only: detectBorrowableOnly(raw, formats),
    title: typeof meta.title === 'string' ? meta.title.trim() : null,
    creator: typeof meta.creator === 'string' ? meta.creator : (Array.isArray(meta.creator) ? meta.creator.join(', ') : null),
    year: normaliseYear(meta.year, meta.date),
    thumbnail_url: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    raw_metadata: meta,
  };
}

module.exports = { extract, extractArchiveOrgId, tokeniseFormats, normaliseLanguage };
