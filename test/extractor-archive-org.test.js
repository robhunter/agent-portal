// extractor-archive-org.test.js — Unit tests for the Archive.org extractor.
//
// Pure-function helpers (token mapping, language/year normalization, id
// extraction) are exercised directly. The HTTPS fetch path is exercised
// indirectly — there's no built-in way to stub `https.request` without
// mocking, and the extractor's contract is "return facts or {_error}",
// which is small enough that the unit tests focus on the parsing side.
// The integration via validateItem against a real Archive.org item is
// covered separately under content-validator.test.js (live network).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extract, extractArchiveOrgId, tokeniseFormats, normaliseLanguage,
} = require('../lib/extractors/archive-org');

describe('extractArchiveOrgId', () => {
  it('extracts the identifier from a standard /details/ URL', () => {
    assert.equal(
      extractArchiveOrgId('https://archive.org/details/blackhammervolum0000lemi'),
      'blackhammervolum0000lemi',
    );
  });
  it('strips a sub-path segment', () => {
    assert.equal(
      extractArchiveOrgId('https://archive.org/details/foo/file.pdf'),
      'foo',
    );
  });
  it('strips query and fragment', () => {
    assert.equal(extractArchiveOrgId('https://archive.org/details/foo?x=1'), 'foo');
    assert.equal(extractArchiveOrgId('https://archive.org/details/foo#bar'), 'foo');
  });
  it('returns null for non-archive.org hosts', () => {
    assert.equal(extractArchiveOrgId('https://example.com/details/foo'), null);
  });
  it('returns null for archive.org without /details/', () => {
    assert.equal(extractArchiveOrgId('https://archive.org/'), null);
  });
  it('returns null for invalid URLs', () => {
    assert.equal(extractArchiveOrgId('not a url'), null);
    assert.equal(extractArchiveOrgId(''), null);
  });
});

describe('tokeniseFormats', () => {
  it('detects cbz / cbr / pdf from Archive.org `format` strings', () => {
    const files = [
      { format: 'Comic Book ZIP' },
      { format: 'Comic Book RAR' },
      { format: 'Text PDF' },
      { format: 'JSON' },
    ];
    const tokens = tokeniseFormats(files).sort();
    assert.deepEqual(tokens, ['cbr', 'cbz', 'pdf']);
  });
  it('detects EPUB and MP3 too', () => {
    const tokens = tokeniseFormats([{ format: 'EPUB' }, { format: 'VBR MP3' }]).sort();
    assert.deepEqual(tokens, ['epub', 'mp3']);
  });
  it('returns [] for empty input', () => {
    assert.deepEqual(tokeniseFormats([]), []);
    assert.deepEqual(tokeniseFormats(null), []);
  });
  it('falls back to file name when format is missing', () => {
    const tokens = tokeniseFormats([{ name: 'comic.cbz' }]);
    assert.deepEqual(tokens, ['cbz']);
  });
});

describe('normaliseLanguage', () => {
  it('lowercases trimmed strings', () => {
    assert.equal(normaliseLanguage('  ENG  '), 'eng');
    assert.equal(normaliseLanguage('eng'), 'eng');
  });
  it('takes the first element of a list', () => {
    assert.equal(normaliseLanguage(['eng', 'spa']), 'eng');
  });
  it('returns null for nullish or unusable input', () => {
    assert.equal(normaliseLanguage(null), null);
    assert.equal(normaliseLanguage(''), null);
    assert.equal(normaliseLanguage(42), null);
  });
});

describe('extract — error paths (no network needed)', () => {
  it('returns {_error} for a non-archive.org URL', async () => {
    const r = await extract('https://example.com/details/foo');
    assert.equal(typeof r._error, 'string');
    assert.match(r._error, /not an archive\.org details URL/);
  });
});

describe('extract — live fetch against archive.org', () => {
  it('returns structured facts for a known item (network required)', async (t) => {
    if (process.env.SKIP_LIVE_TESTS === '1') {
      t.skip('SKIP_LIVE_TESTS=1');
      return;
    }
    const r = await extract('https://archive.org/details/blackhammervolum0000lemi');
    if (r._error) {
      t.diagnostic(`live archive.org fetch failed (skipping assertions): ${r._error}`);
      return;
    }
    assert.equal(r.identifier, 'blackhammervolum0000lemi');
    assert.equal(r.language, 'eng');
    assert.ok(Array.isArray(r.available_formats));
    assert.ok(r.available_formats.includes('pdf'));
    assert.equal(typeof r.title, 'string');
    assert.equal(typeof r.borrowable_only, 'boolean');
    assert.equal(typeof r.year, 'number');
    assert.match(r.thumbnail_url, /archive\.org\/services\/img\//);
  });
});
