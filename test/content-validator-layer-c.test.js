// content-validator-layer-c.test.js — Tests for Layer C of validateItem
// (extractor + tenant preference check).
//
// Layer C is opt-in: tenants without preferences.<cat>.constraints in
// memory/preferences.yaml get only Layers A+B and no behavior change vs.
// the legacy validator. These tests cover both the opt-in path (constraints
// present → enforcement applied) and the opt-out path (no constraints →
// silent skip).
//
// The Archive.org extractor is the registered extractor used here. Tests
// run against the live Archive.org metadata API; set SKIP_LIVE_TESTS=1 to
// skip them. The extractor's own pure-function tests live in
// extractor-archive-org.test.js.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { validateItem, loadConstraints } = require('../lib/content-validator');

const LIVE_URL = 'https://archive.org/details/blackhammervolum0000lemi';

function makeApprovedArchiveSource() {
  return [{
    id: 'archive-org',
    name: 'Archive.org',
    url: 'https://archive.org',
    hosts: ['archive.org'],
    status: 'approved',
  }];
}

function makeItem(overrides = {}) {
  return {
    id: 'test-bhv1',
    title: 'Black Hammer Vol. 1',
    category: 'comics',
    format: 'pdf',
    source: 'archive-org',
    source_url: LIVE_URL,
    status: 'linked',
    sources: [{ name: 'Archive.org', url: LIVE_URL, type: 'downloadable' }],
    ...overrides,
  };
}

function makeTempDataRoot(preferencesYaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pref-check-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  if (preferencesYaml != null) {
    fs.writeFileSync(path.join(dir, 'memory', 'preferences.yaml'), preferencesYaml);
  }
  return dir;
}

describe('loadConstraints', () => {
  it('returns null when memory/preferences.yaml does not exist', () => {
    const dir = makeTempDataRoot(null);
    assert.equal(loadConstraints(dir, 'comics'), null);
  });
  it('returns null when category has no constraints subtree', () => {
    const dir = makeTempDataRoot(yaml.dump({
      preferences: { comics: { likes: [], dislikes: [] } },
    }));
    assert.equal(loadConstraints(dir, 'comics'), null);
  });
  it('returns the constraints subtree when configured', () => {
    const constraints = { formats: { accept: ['cbz', 'cbr'] } };
    const dir = makeTempDataRoot(yaml.dump({
      preferences: { comics: { constraints } },
    }));
    assert.deepEqual(loadConstraints(dir, 'comics'), constraints);
  });
});

describe('validateItem — Layer C (extractor + preference check)', () => {
  // These tests hit live archive.org. Skip in offline environments.
  const skipReason = process.env.SKIP_LIVE_TESTS === '1' ? 'SKIP_LIVE_TESTS=1' : null;

  it('passes when no constraints are configured (backward compat)', async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const dataRoot = makeTempDataRoot(null);  // no preferences.yaml
    const r = await validateItem(makeItem(), makeApprovedArchiveSource(), {
      dataRoot,
      // Layers A+B still run; this verifies no regression for legacy tenants.
    });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('passes when constraints allow the item (e.g., pdf permitted)', async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const dataRoot = makeTempDataRoot(yaml.dump({
      preferences: {
        comics: {
          constraints: {
            formats: { accept: ['pdf'] },
            languages: { accept: ['en'] },
          },
        },
      },
    }));
    const r = await validateItem(makeItem(), makeApprovedArchiveSource(), { dataRoot });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(r.extractor, 'extractor report should be populated');
    assert.equal(r.extractor.facts.language, 'eng');
  });

  it('rejects when constraints exclude the available format', async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const dataRoot = makeTempDataRoot(yaml.dump({
      preferences: {
        comics: {
          constraints: {
            formats: { accept: ['cbz', 'cbr'] },  // pdf NOT accepted
            languages: { accept: ['en'] },
          },
        },
      },
    }));
    // black-hammer-vol1 on archive.org is PDF/EPUB only — no CBZ/CBR.
    // Expected: Layer C rejects on formats.
    const r = await validateItem(makeItem(), makeApprovedArchiveSource(), { dataRoot });
    if (r.ok) {
      // If the extractor failed (network), the layer is graceful; allow.
      const warned = r.warnings && r.warnings.some(w => /extractor failed/.test(w.reason));
      assert.ok(warned, 'expected either rejection or extractor-failed warning');
      return;
    }
    assert.ok(r.errors.some(e => e.field === 'formats'),
      `expected formats error; got ${JSON.stringify(r.errors)}`);
  });

  it('skipExtraction=true bypasses Layer C entirely', async (t) => {
    if (skipReason) { t.skip(skipReason); return; }
    const dataRoot = makeTempDataRoot(yaml.dump({
      preferences: {
        comics: {
          constraints: { formats: { accept: ['cbz'] } },  // would reject pdf
        },
      },
    }));
    const r = await validateItem(makeItem(), makeApprovedArchiveSource(), {
      dataRoot,
      skipExtraction: true,
    });
    assert.equal(r.ok, true, 'skipExtraction should disable Layer C');
    assert.equal(r.extractor, undefined);
  });
});

describe('validateItem — Layer C for non-extractor sources', () => {
  it('skips Layer C when source has no registered extractor (e.g., Netflix)', async () => {
    const dataRoot = makeTempDataRoot(yaml.dump({
      preferences: { movies: { constraints: { formats: { accept: ['link'] } } } },
    }));
    const sources = [{
      id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com',
      hosts: ['www.netflix.com'], status: 'approved',
    }];
    const item = {
      id: 'm1', title: 'Test', category: 'movies', source: 'netflix',
      source_url: 'https://www.netflix.com/title/123',
      status: 'linked', format: 'link',
      sources: [{ name: 'Netflix', url: 'https://www.netflix.com/title/123', type: 'link-only' }],
    };
    // skipFetch so we don't actually hit netflix.com; Layer C is what we're
    // testing — it should be silently skipped (no extractor registered for
    // netflix.com → no facts → no preference enforcement).
    const r = await validateItem(item, sources, { dataRoot, skipFetch: true });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.extractor, undefined);
  });
});
