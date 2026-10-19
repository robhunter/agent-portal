const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const yaml = require('js-yaml');

describe('YAML resource limits', () => {
  it('preserves ordinary configuration merges and ordered mappings', () => {
    const parsed = yaml.load([
      'defaults: &defaults {status: approved, type: rss}',
      'sources:',
      '  - <<: *defaults',
      '    id: example',
      'ordered: !!omap',
      '  - first: 1',
      '  - second: 2',
    ].join('\n'));
    assert.deepEqual(parsed.sources, [{ status: 'approved', type: 'rss', id: 'example' }]);
    assert.deepEqual(parsed.ordered, [{ first: 1 }, { second: 2 }]);
  });

  it('limits repeated nonempty merge sources', () => {
    const document = 'source: &source {status: approved}\ntargets:\n' + '  - <<: *source\n'.repeat(20);
    assert.throws(() => yaml.load(document, { maxTotalMergeKeys: 16 }), /maxTotalMergeKeys/);
  });

  it('charges empty merge sources against the same work budget', () => {
    const document = 'sources: &sources [{}, {}, {}, {}]\ntargets:\n' + '  - <<: *sources\n'.repeat(5);
    assert.throws(() => yaml.load(document, { maxTotalMergeKeys: 16 }), /maxTotalMergeKeys/);
  });
});
