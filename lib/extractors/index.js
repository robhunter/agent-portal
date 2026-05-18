// extractors/index.js — Hostname → extractor registry.
//
// Source extractors are reusable across categories and tenants. They report
// facts about a URL with no judgment about whether those facts are
// "acceptable" — that's the preference-checker's job (see
// lib/preference-checker.js).
//
// To add a new extractor: drop a module under lib/extractors/<name>.js that
// exports an `extract(url, opts)` function, then register its hostnames
// here. No agent-specific or per-tenant code lives in this file.

const archiveOrg = require('./archive-org');

const REGISTRY = [
  { hosts: ['archive.org'], extractor: archiveOrg },
];

function lookup(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); }
  catch { return null; }
  for (const entry of REGISTRY) {
    if (entry.hosts.includes(host)) return entry.extractor;
  }
  return null;
}

module.exports = { lookup, REGISTRY };
