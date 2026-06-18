// content-validator-layer-c-hermetic.test.js — Deterministic, NETWORK-FREE
// tests for Layer C of validateItem (extractor + tenant preference check).
//
// WHY THIS FILE EXISTS (separate from content-validator-layer-c.test.js):
//   The sibling layer-c test file exercises the same wiring against the LIVE
//   Archive.org metadata API. Those live tests (a) make CI depend on
//   archive.org being reachable on every PR, and (b) take graceful-fallback
//   branches that silently pass WITHOUT asserting the wiring when the network
//   is unavailable — so the Layer C integration glue (extractor facts ->
//   loadConstraints -> preference-checker -> error/warning merge -> ok flag)
//   has no DETERMINISTIC regression protection. Layers A+B, by contrast, are
//   already covered hermetically by content-validator.test.js (a local
//   http.createServer on 127.0.0.1). This file closes that gap for Layer C.
//
// HOW IT STAYS HERMETIC:
//   - The only network leaf in Layer C is the extractor's own fetch. We mock
//     `archiveOrg.extract` (via node:test's mock.method) so the REAL
//     extractors.lookup registry still routes archive.org URLs to the
//     archive-org module, but the fetch is replaced with canned facts.
//   - skipFetch:true disables Layer B's liveness fetch (Layer C is gated by
//     skipExtraction, not skipFetch, so it still runs).
//   Net: every assertion below runs with zero network I/O.

const { describe, it, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const archiveOrg = require('../lib/extractors/archive-org');
const { validateItem } = require('../lib/content-validator');

const ARCHIVE_URL = 'https://archive.org/details/foo';

function approvedArchiveSource() {
  return [{ id: 'archive-org', name: 'Archive.org', hosts: ['archive.org'], status: 'approved' }];
}

function makeItem(overrides = {}) {
  return {
    id: 'i1',
    title: 'Test Item',
    category: 'comics',
    source: 'archive-org',
    source_url: ARCHIVE_URL,
    status: 'linked',
    ...overrides,
  };
}

// Default "healthy" facts an extractor would return for a freely-downloadable,
// English, PDF item. Individual tests override fields to drive each branch.
function facts(overrides = {}) {
  return {
    identifier: 'foo',
    language: 'eng',
    available_formats: ['pdf'],
    borrowable_only: false,
    title: 'Test Item',
    ...overrides,
  };
}

// Create a throwaway dataRoot containing memory/preferences.yaml (or none).
function dataRootWith(preferences) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layerc-herm-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  if (preferences != null) {
    fs.writeFileSync(path.join(dir, 'memory', 'preferences.yaml'), yaml.dump(preferences));
  }
  return dir;
}

// Mock the extractor's network leaf so Layer C runs without I/O. Returns the
// mock handle so a test can assert call count. Restored in afterEach.
function stubExtract(impl) {
  return mock.method(archiveOrg, 'extract', impl);
}

// Run validateItem against an archive.org item with Layer B disabled. Layer C
// runs against the (mocked) extractor.
function validate(item, sources, opts) {
  return validateItem(item, sources, { skipFetch: true, ...opts });
}

describe('Layer C wiring — hermetic (no network)', () => {
  afterEach(() => mock.restoreAll());

  it('passes and reports facts when the item satisfies constraints', async () => {
    const m = stubExtract(async () => facts());
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { formats: { accept: ['pdf'] }, languages: { accept: ['en'] } } } },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(m.mock.calls.length, 1, 'real lookup routed to (mocked) extract');
    assert.ok(r.extractor, 'extractor report populated');
    assert.equal(r.extractor.source, ARCHIVE_URL);
    assert.equal(r.extractor.facts.language, 'eng', 'facts flowed into the report');
    assert.deepEqual(r.errors, []);
  });

  it('rejects on a disallowed format (error merged from preference-checker)', async () => {
    stubExtract(async () => facts({ available_formats: ['pdf'] }));
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { formats: { accept: ['cbz', 'cbr'] } } } },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'formats'), JSON.stringify(r.errors));
  });

  it('rejects on a disallowed language', async () => {
    stubExtract(async () => facts({ language: 'spa' }));
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { languages: { accept: ['en'] } } } },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'language'), JSON.stringify(r.errors));
  });

  it('rejects a borrowable-only item when borrowable_ok=false', async () => {
    stubExtract(async () => facts({ borrowable_only: true }));
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { borrowable_ok: false } } },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'borrowable_only'), JSON.stringify(r.errors));
  });

  it('merges ALL violations from a multi-failure item', async () => {
    stubExtract(async () => facts({ language: 'spa', available_formats: ['pdf'], borrowable_only: true }));
    const dataRoot = dataRootWith({
      preferences: {
        comics: {
          constraints: {
            languages: { accept: ['en'] },
            formats: { accept: ['cbz', 'cbr'] },
            borrowable_ok: false,
          },
        },
      },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, false);
    const fields = r.errors.map(e => e.field).sort();
    assert.deepEqual(fields, ['borrowable_only', 'formats', 'language'],
      `expected all three violations merged; got ${JSON.stringify(r.errors)}`);
  });

  it('merges WARNINGS (not errors) for an unknown fact under the default policy', async () => {
    // available_formats empty => "fact unavailable" => warn (default), not reject.
    stubExtract(async () => facts({ available_formats: [] }));
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { formats: { accept: ['pdf'] } } } },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(r.warnings.some(w => w.field === 'formats'),
      `expected a formats warning; got ${JSON.stringify(r.warnings)}`);
  });

  it('honors unknown_field_policy=reject (warning is promoted to a failing error)', async () => {
    stubExtract(async () => facts({ available_formats: [] }));
    const dataRoot = dataRootWith({
      preferences: {
        comics: { constraints: { formats: { accept: ['pdf'] }, unknown_field_policy: { formats: 'reject' } } },
      },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'formats'), JSON.stringify(r.errors));
  });

  it('treats an extractor _error as a graceful WARNING (no crash, preference check skipped)', async () => {
    stubExtract(async () => ({ _error: 'simulated metadata fetch failure' }));
    const dataRoot = dataRootWith({
      // Constraints that WOULD reject if facts were available — must not apply
      // because the extractor produced no facts.
      preferences: { comics: { constraints: { formats: { accept: ['cbz'] } } } },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, true, 'extractor failure must not fail the item');
    assert.ok(r.warnings.some(w => /extractor failed/.test(w.reason)),
      `expected an extractor-failed warning; got ${JSON.stringify(r.warnings)}`);
    assert.ok(r.extractor && r.extractor.facts && r.extractor.facts._error,
      'extractor report should surface the _error');
  });

  it('treats a null extractor result as a graceful warning (no crash)', async () => {
    stubExtract(async () => null);
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { formats: { accept: ['cbz'] } } } },
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some(w => /extractor failed/.test(w.reason)), JSON.stringify(r.warnings));
  });

  it('applies no enforcement when the category has no constraints (backward compat)', async () => {
    // Extractor runs and reports facts, but with no preferences.yaml there is
    // nothing to enforce — Layers A+B behavior is preserved.
    const m = stubExtract(async () => facts({ language: 'spa', available_formats: ['pdf'] }));
    const dataRoot = dataRootWith(null); // no preferences.yaml at all
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(m.mock.calls.length, 1, 'extractor still runs (report is populated)');
    assert.ok(r.extractor, 'extractor report present even without constraints');
    assert.deepEqual(r.errors, []);
  });

  it('uses item.category to select constraints (constraints under a different category do not apply)', async () => {
    // Item is "comics"; constraints live only under "movies" => not applied.
    stubExtract(async () => facts({ language: 'spa' }));
    const dataRoot = dataRootWith({
      preferences: { movies: { constraints: { languages: { accept: ['en'] } } } },
    });
    const r = await validate(makeItem({ category: 'comics' }), approvedArchiveSource(), { dataRoot });
    assert.equal(r.ok, true, 'a comics item is not subject to movies constraints');
    assert.deepEqual(r.errors, []);
  });

  it('skipExtraction=true bypasses Layer C entirely (extractor never called)', async () => {
    const m = stubExtract(async () => facts({ available_formats: ['pdf'] }));
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { formats: { accept: ['cbz'] } } } }, // would reject
    });
    const r = await validate(makeItem(), approvedArchiveSource(), { dataRoot, skipExtraction: true });
    assert.equal(r.ok, true, 'skipExtraction disables Layer C');
    assert.equal(m.mock.calls.length, 0, 'extractor must not be called');
    assert.equal(r.extractor, undefined, 'no extractor report when skipped');
  });

  it('skips Layer C for a source whose host has no registered extractor', async () => {
    const m = stubExtract(async () => facts()); // should never be called for netflix
    const sources = [{ id: 'netflix', name: 'Netflix', hosts: ['www.netflix.com'], status: 'approved' }];
    const item = makeItem({
      source: 'netflix',
      source_url: 'https://www.netflix.com/title/123',
      category: 'movies',
    });
    const dataRoot = dataRootWith({
      preferences: { movies: { constraints: { formats: { accept: ['cbz'] } } } },
    });
    const r = await validate(item, sources, { dataRoot });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(m.mock.calls.length, 0, 'archive-org extractor not invoked for a netflix URL');
    assert.equal(r.extractor, undefined, 'no extractor report when no extractor is registered');
  });

  it('does NOT run Layer C when Layer A produced errors (extractor gated behind a clean A/B)', async () => {
    const m = stubExtract(async () => facts());
    // Host not in the approved registry => Layer A error => early return before Layer C.
    const sources = [{ id: 'other', name: 'Other', hosts: ['example.com'], status: 'approved' }];
    const item = makeItem({ source: 'other', source_url: 'https://archive.org/details/foo' });
    const dataRoot = dataRootWith({
      preferences: { comics: { constraints: { formats: { accept: ['pdf'] } } } },
    });
    const r = await validate(item, sources, { dataRoot });
    assert.equal(r.ok, false);
    assert.equal(m.mock.calls.length, 0, 'extractor must not run once structural errors exist');
    assert.equal(r.extractor, undefined);
  });
});
