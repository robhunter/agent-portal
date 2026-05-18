// preference-checker.js — Generic tenant-preference enforcement.
//
// Applies a tenant's per-category constraints to extractor-derived facts.
// No tenant-specific values live here; the constraints come from the
// caller (typically <agentDir>/<dataDir>/memory/preferences.yaml at the path
// `preferences.<category>.constraints`).
//
// This module is shared framework code in agent-portal — it MUST NOT contain
// any agent-specific preferences. Multi-tenant safety depends on that.
//
// Constraints schema (v1):
//
//   formats:
//     accept: [string, ...]      # tokens like cbz, cbr, pdf — case-insensitive
//   languages:
//     accept: [string, ...]      # ISO 639-1/2 codes — "en", "eng", "english"
//                                # are treated as equivalent
//   borrowable_ok: bool          # if false, facts.borrowable_only=true is rejected
//   unknown_field_policy:        # what to do when a fact is null/undefined
//     language: reject | warn | accept   (default: warn)
//     formats:  reject | warn | accept   (default: warn)
//     borrowable_only: reject | warn | accept  (default: warn)
//
// Returns { errors: [...], warnings: [...] } where each entry is
// { field, reason, value? } in the same shape used by content-validator.

const LANGUAGE_ALIASES = {
  en: 'en', eng: 'en', english: 'en',
  es: 'es', spa: 'es', spanish: 'es',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr',
  de: 'de', ger: 'de', deu: 'de', german: 'de',
  ja: 'ja', jpn: 'ja', japanese: 'ja',
  zh: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh',
};

function normLang(s) {
  if (s == null) return null;
  const k = String(s).trim().toLowerCase();
  return LANGUAGE_ALIASES[k] || k;
}

function getUnknownPolicy(constraints, key) {
  const p = (constraints.unknown_field_policy || {})[key];
  if (p === 'reject' || p === 'warn' || p === 'accept') return p;
  return 'warn';
}

function pushUnknown(out, field, policy) {
  if (policy === 'accept') return;
  const entry = { field, reason: 'fact unavailable from extractor; cannot verify against constraints' };
  if (policy === 'reject') out.errors.push(entry);
  else out.warnings.push(entry);
}

function checkLanguage(facts, constraints, out) {
  const accept = (constraints.languages && Array.isArray(constraints.languages.accept))
    ? constraints.languages.accept.map(normLang)
    : null;
  if (!accept || accept.length === 0) return; // no constraint configured

  if (facts.language == null) {
    pushUnknown(out, 'language', getUnknownPolicy(constraints, 'language'));
    return;
  }
  const got = normLang(facts.language);
  if (!accept.includes(got)) {
    out.errors.push({
      field: 'language',
      value: facts.language,
      reason: `language '${facts.language}' not in accept list ${JSON.stringify(constraints.languages.accept)}`,
    });
  }
}

function checkFormats(facts, constraints, out) {
  const accept = (constraints.formats && Array.isArray(constraints.formats.accept))
    ? constraints.formats.accept.map(s => String(s).toLowerCase())
    : null;
  if (!accept || accept.length === 0) return;

  const available = Array.isArray(facts.available_formats) ? facts.available_formats : null;
  if (!available || available.length === 0) {
    pushUnknown(out, 'formats', getUnknownPolicy(constraints, 'formats'));
    return;
  }
  const intersect = available.map(s => s.toLowerCase()).filter(t => accept.includes(t));
  if (intersect.length === 0) {
    out.errors.push({
      field: 'formats',
      value: facts.available_formats,
      reason: `available formats ${JSON.stringify(facts.available_formats)} do not intersect accept list ${JSON.stringify(constraints.formats.accept)}`,
    });
  }
}

function checkBorrowable(facts, constraints, out) {
  if (constraints.borrowable_ok !== false) return; // default: borrowable allowed
  if (facts.borrowable_only == null) {
    pushUnknown(out, 'borrowable_only', getUnknownPolicy(constraints, 'borrowable_only'));
    return;
  }
  if (facts.borrowable_only === true) {
    out.errors.push({
      field: 'borrowable_only',
      reason: 'item is borrowable-only and tenant policy is borrowable_ok=false',
    });
  }
}

/**
 * Check facts against a tenant's category-level constraints.
 * @param {object} facts — extractor output (see lib/extractors/*).
 * @param {object} constraints — preferences.<category>.constraints subtree.
 * @returns {{ errors: Array, warnings: Array }}
 */
function check(facts, constraints) {
  const out = { errors: [], warnings: [] };
  if (!constraints || typeof constraints !== 'object') return out;
  if (!facts || typeof facts !== 'object') return out;
  checkLanguage(facts, constraints, out);
  checkFormats(facts, constraints, out);
  checkBorrowable(facts, constraints, out);
  return out;
}

module.exports = { check, normLang };
