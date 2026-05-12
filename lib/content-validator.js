// content-validator.js — Validate content items before they land in
// <dataDir>/content/items/. Enforced via scripts/publish-content.sh.
//
// Two layers:
//   A. Host allowlist — every URL field must match a host of an approved
//      source in <dataDir>/config/sources.yaml. The item's primary `source`
//      field must reference an approved source id.
//   B. Live fetch — HEAD (GET fallback on 405) with 10s timeout and 2
//      retries on connection errors. 2xx/3xx = pass, anything else = fail.
//
// Cover URLs (`metadata.cover_url`) are intentionally NOT validated — they
// often come from third-party CDNs that aren't content sources. The safety
// concern is navigational/source URLs, not thumbnails.
//
// Zero external deps. Uses only Node built-ins. Designed to be reusable
// from a CLI wrapper and, eventually, an HTTP route on the portal.

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULTS = {
  fetchTimeoutMs: 10000,
  fetchRetries: 2,
  fetchRetryDelaysMs: [1000, 3000],
  followRedirects: 5,
  userAgent: 'agent-portal-publish-validator/1.0',
};

const REQUIRED_FIELDS = ['id', 'title', 'category', 'source', 'source_url', 'status'];

const RECOVERABLE_ERROR_CODES = new Set([
  'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'EAI_AGAIN', 'ECONNREFUSED',
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build a host → source map from an approved-sources list.
 * Uses each source's `hosts:` field, falling back to the hostname parsed
 * from `url:` for backwards compat with sources that haven't declared hosts.
 */
function buildHostsMap(approvedSources) {
  const hosts = new Map();
  for (const s of approvedSources) {
    let sourceHosts = Array.isArray(s.hosts) ? [...s.hosts] : [];
    if (sourceHosts.length === 0 && s.url) {
      try { sourceHosts.push(new URL(s.url).hostname); } catch {}
    }
    for (const h of sourceHosts) {
      if (typeof h === 'string' && h) hosts.set(h.toLowerCase(), s);
    }
  }
  return hosts;
}

/**
 * Single HTTP(S) request. Returns { ok, status, reason, recoverable }.
 */
function singleRequest(targetUrl, method, options, redirectsRemaining) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(targetUrl); }
    catch { return resolve({ ok: false, status: null, reason: 'invalid URL', recoverable: false }); }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return resolve({ ok: false, status: null, reason: `unsupported protocol '${parsed.protocol}'`, recoverable: false });
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': options.userAgent };
    if (method === 'GET') headers['Range'] = 'bytes=0-1023';

    const req = client.request(parsed, {
      method,
      headers,
      timeout: options.fetchTimeoutMs,
    }, res => {
      const status = res.statusCode;
      res.resume();

      // Follow redirects
      if (status >= 300 && status < 400 && res.headers.location && redirectsRemaining > 0) {
        const nextUrl = new URL(res.headers.location, parsed).href;
        return resolve(singleRequest(nextUrl, method, options, redirectsRemaining - 1));
      }

      const ok = status >= 200 && status < 400;
      resolve({ ok, status, reason: ok ? null : `HTTP ${status}`, recoverable: false });
    });

    req.on('error', err => {
      const recoverable = RECOVERABLE_ERROR_CODES.has(err.code);
      resolve({ ok: false, status: null, reason: err.code || err.message, recoverable });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: null, reason: 'timeout', recoverable: true });
    });

    req.end();
  });
}

/**
 * Fetch a URL with HEAD→GET fallback and retry on recoverable connection errors.
 */
async function fetchUrl(targetUrl, options = {}) {
  // Spread DEFAULTS first, then only the defined entries from options.
  // Plain spread would let `undefined` values shadow defaults.
  const definedOptions = Object.fromEntries(
    Object.entries(options).filter(([, v]) => v !== undefined)
  );
  const opts = { ...DEFAULTS, ...definedOptions };
  let lastResult = null;

  for (let attempt = 0; attempt <= opts.fetchRetries; attempt++) {
    if (attempt > 0) {
      const delay = opts.fetchRetryDelaysMs[attempt - 1] ?? opts.fetchRetryDelaysMs[opts.fetchRetryDelaysMs.length - 1];
      await sleep(delay);
    }

    let result = await singleRequest(targetUrl, 'HEAD', opts, opts.followRedirects);
    if (result.status === 405) {
      // HEAD disallowed — try GET
      result = await singleRequest(targetUrl, 'GET', opts, opts.followRedirects);
    }

    lastResult = result;
    if (result.ok || !result.recoverable) return result;
    // Recoverable failure — fall through to next retry
  }

  return lastResult;
}

/**
 * Collect (field, url) pairs from an item — every URL we will validate.
 * Cover URLs and arbitrary metadata.* URLs are NOT collected.
 */
function collectUrls(item) {
  const checks = [];
  if (item.source_url) checks.push({ field: 'source_url', url: item.source_url });
  if (Array.isArray(item.sources)) {
    item.sources.forEach((s, i) => {
      if (s && typeof s.url === 'string' && s.url) {
        checks.push({ field: `sources[${i}].url`, url: s.url });
      }
    });
  }
  return checks;
}

/**
 * Validate a content item against a sources registry.
 *
 * @param {object} item — parsed YAML for the content item
 * @param {Array}  sources — entries from sources.yaml
 * @param {object} options — { skipFetch?: bool, fetchTimeoutMs?, fetchRetries?, fetchRetryDelaysMs? }
 * @returns {Promise<{ok: boolean, errors: Array<{field, url?, value?, reason}>}>}
 */
async function validateItem(item, sources, options = {}) {
  const errors = [];

  if (!item || typeof item !== 'object') {
    return { ok: false, errors: [{ field: '(root)', reason: 'item is not an object' }] };
  }

  for (const f of REQUIRED_FIELDS) {
    if (item[f] === undefined || item[f] === null || item[f] === '') {
      errors.push({ field: f, reason: 'required field missing' });
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const approvedSources = (Array.isArray(sources) ? sources : []).filter(s => s && s.status === 'approved');
  const approvedById = new Map(approvedSources.map(s => [s.id, s]));
  const hostsMap = buildHostsMap(approvedSources);

  // Primary source must reference an approved registry entry
  if (!approvedById.has(item.source)) {
    errors.push({
      field: 'source',
      value: item.source,
      reason: `source id '${item.source}' is not in any approved registry entry (must be present in sources.yaml with status: approved)`,
    });
  }

  const urlChecks = collectUrls(item);

  // Layer A: host allowlist
  for (const c of urlChecks) {
    let host;
    try { host = new URL(c.url).hostname.toLowerCase(); }
    catch { errors.push({ field: c.field, url: c.url, reason: 'invalid URL' }); continue; }
    if (!hostsMap.has(host)) {
      errors.push({ field: c.field, url: c.url, reason: `host '${host}' is not in any approved source` });
    }
  }

  // If host check failed, don't bother with fetches — re-publish with fixed URLs first
  if (errors.length > 0) return { ok: false, errors };

  // Layer B: live fetch (skip in --skip-fetch mode)
  if (!options.skipFetch && urlChecks.length > 0) {
    const fetchOpts = {
      fetchTimeoutMs: options.fetchTimeoutMs,
      fetchRetries: options.fetchRetries,
      fetchRetryDelaysMs: options.fetchRetryDelaysMs,
      userAgent: options.userAgent,
      followRedirects: options.followRedirects,
    };
    const results = await Promise.all(
      urlChecks.map(c => fetchUrl(c.url, fetchOpts).then(r => ({ ...c, ...r })))
    );
    for (const r of results) {
      if (!r.ok) {
        errors.push({ field: r.field, url: r.url, reason: r.status ? `HTTP ${r.status}` : r.reason });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateItem, fetchUrl, collectUrls, buildHostsMap, DEFAULTS };
