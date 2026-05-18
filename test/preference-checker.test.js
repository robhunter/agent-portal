// preference-checker.test.js — Unit tests for tenant-preference enforcement.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { check, normLang } = require('../lib/preference-checker');

describe('normLang', () => {
  it('aliases common English variants to "en"', () => {
    assert.equal(normLang('en'), 'en');
    assert.equal(normLang('eng'), 'en');
    assert.equal(normLang('English'), 'en');
    assert.equal(normLang('  ENGLISH  '), 'en');
  });
  it('aliases Spanish variants', () => {
    assert.equal(normLang('es'), 'es');
    assert.equal(normLang('spa'), 'es');
    assert.equal(normLang('Spanish'), 'es');
  });
  it('passes unknown codes through lowercased', () => {
    assert.equal(normLang('xx'), 'xx');
  });
  it('handles null', () => {
    assert.equal(normLang(null), null);
  });
});

describe('check — empty / missing constraints', () => {
  it('returns no errors when constraints is null', () => {
    const result = check({ language: 'spa' }, null);
    assert.deepEqual(result, { errors: [], warnings: [] });
  });
  it('returns no errors when constraints is empty object', () => {
    const result = check({ language: 'spa' }, {});
    assert.deepEqual(result, { errors: [], warnings: [] });
  });
});

describe('check — languages.accept', () => {
  const constraints = { languages: { accept: ['en'] } };

  it('accepts a fact whose language matches the accept list', () => {
    const result = check({ language: 'eng' }, constraints);
    assert.deepEqual(result.errors, []);
  });
  it('rejects a non-accepted language', () => {
    const result = check({ language: 'spa' }, constraints);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].field, 'language');
    assert.match(result.errors[0].reason, /not in accept list/);
  });
  it('warns by default when language is unknown', () => {
    const result = check({ language: null }, constraints);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].field, 'language');
  });
  it('rejects an unknown language when unknown_field_policy.language=reject', () => {
    const c = { ...constraints, unknown_field_policy: { language: 'reject' } };
    const result = check({ language: null }, c);
    assert.equal(result.errors.length, 1);
    assert.equal(result.warnings.length, 0);
  });
  it('accepts an unknown language when unknown_field_policy.language=accept', () => {
    const c = { ...constraints, unknown_field_policy: { language: 'accept' } };
    const result = check({ language: null }, c);
    assert.deepEqual(result, { errors: [], warnings: [] });
  });
});

describe('check — formats.accept', () => {
  const constraints = { formats: { accept: ['cbz', 'cbr'] } };

  it('accepts when available_formats intersects accept', () => {
    const result = check({ available_formats: ['cbz', 'pdf'] }, constraints);
    assert.deepEqual(result.errors, []);
  });
  it('rejects when available_formats does not intersect', () => {
    const result = check({ available_formats: ['pdf', 'epub'] }, constraints);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].field, 'formats');
  });
  it('is case-insensitive on available_formats', () => {
    const result = check({ available_formats: ['CBZ'] }, constraints);
    assert.deepEqual(result.errors, []);
  });
  it('warns by default when available_formats is empty', () => {
    const result = check({ available_formats: [] }, constraints);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
  });
});

describe('check — borrowable_ok', () => {
  it('rejects borrowable_only=true when borrowable_ok=false', () => {
    const result = check({ borrowable_only: true }, { borrowable_ok: false });
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].field, 'borrowable_only');
  });
  it('accepts borrowable_only=true when borrowable_ok=true', () => {
    const result = check({ borrowable_only: true }, { borrowable_ok: true });
    assert.deepEqual(result.errors, []);
  });
  it('accepts borrowable_only=false regardless of policy', () => {
    const result = check({ borrowable_only: false }, { borrowable_ok: false });
    assert.deepEqual(result.errors, []);
  });
  it('warns on null borrowable_only when borrowable_ok=false', () => {
    const result = check({ borrowable_only: null }, { borrowable_ok: false });
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
  });
});

describe('check — combined', () => {
  it('returns all violations from a multi-failure item', () => {
    const constraints = {
      languages: { accept: ['en'] },
      formats: { accept: ['cbz', 'cbr'] },
      borrowable_ok: false,
    };
    const facts = { language: 'spa', available_formats: ['pdf'], borrowable_only: true };
    const result = check(facts, constraints);
    assert.equal(result.errors.length, 3);
    const fields = result.errors.map(e => e.field).sort();
    assert.deepEqual(fields, ['borrowable_only', 'formats', 'language']);
  });
});
