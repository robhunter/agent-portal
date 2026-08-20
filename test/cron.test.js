const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { expandField, isCycleLocked, getNextRun } = require('../lib/cron');

describe('expandField', () => {
  it('expands wildcard', () => {
    const values = expandField('*', 0, 5);
    assert.deepEqual([...values].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
  });

  it('expands single value', () => {
    const values = expandField('5', 0, 59);
    assert.deepEqual([...values], [5]);
  });

  it('expands range', () => {
    const values = expandField('1-5', 0, 59);
    assert.deepEqual([...values].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  it('expands step on wildcard', () => {
    const values = expandField('*/15', 0, 59);
    assert.deepEqual([...values].sort((a, b) => a - b), [0, 15, 30, 45]);
  });

  it('expands step on range', () => {
    const values = expandField('1-10/3', 0, 59);
    assert.deepEqual([...values].sort((a, b) => a - b), [1, 4, 7, 10]);
  });

  it('expands comma-separated list', () => {
    const values = expandField('1,3,5', 0, 59);
    assert.deepEqual([...values].sort((a, b) => a - b), [1, 3, 5]);
  });

  it('expands complex expression', () => {
    const values = expandField('0,15,30,45', 0, 59);
    assert.deepEqual([...values].sort((a, b) => a - b), [0, 15, 30, 45]);
  });

  it('handles day-of-week range', () => {
    const values = expandField('1-5', 0, 6);
    assert.deepEqual([...values].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  it('handles month range', () => {
    const values = expandField('*', 1, 12);
    assert.deepEqual([...values].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('expands step starting from value', () => {
    const values = expandField('5/10', 0, 59);
    assert.deepEqual([...values].sort((a, b) => a - b), [5, 15, 25, 35, 45, 55]);
  });
});

describe('isCycleLocked', () => {
  it('returns false when no lock file exists', () => {
    const lockFile = path.join(os.tmpdir(), `test-lock-${Date.now()}-noexist`);
    assert.equal(isCycleLocked(lockFile), false);
  });

  it('returns false when lockFile is falsy', () => {
    assert.equal(isCycleLocked(null), false);
    assert.equal(isCycleLocked(''), false);
  });

  it('returns true when .starting marker exists and is fresh', () => {
    const lockFile = path.join(os.tmpdir(), `test-lock-${Date.now()}-marker`);
    const markerFile = lockFile + '.starting';
    fs.writeFileSync(markerFile, '1');
    try {
      assert.equal(isCycleLocked(lockFile), true);
    } finally {
      try { fs.unlinkSync(markerFile); } catch {}
    }
  });

  it('cleans up stale .starting marker and returns false', () => {
    const lockFile = path.join(os.tmpdir(), `test-lock-${Date.now()}-stale`);
    const markerFile = lockFile + '.starting';
    fs.writeFileSync(markerFile, '1');
    // Backdate the marker to 60 seconds ago
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(markerFile, past, past);
    try {
      assert.equal(isCycleLocked(lockFile), false);
      assert.equal(fs.existsSync(markerFile), false, 'stale marker should be cleaned up');
    } finally {
      try { fs.unlinkSync(markerFile); } catch {}
    }
  });
});

describe('getNextRun enabled flag', () => {
  // Every assertion here is on `enabled` alone, because it is the one field that
  // does not depend on whether a cron daemon happens to be alive in the
  // environment running the tests.
  const withCronFile = (contents, fn) => {
    const file = path.join(os.tmpdir(), `test-cron-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(file, contents);
    try {
      fn(file);
    } finally {
      try { fs.unlinkSync(file); } catch {}
    }
  };

  const WAKE = '0 */2 * * * root /root/workspaces/agent-portal/scripts/wake.sh /root/a >> /log 2>&1';

  it('reports enabled for a live wake line', () => {
    withCronFile(`SHELL=/bin/bash\n${WAKE}\n`, (file) => {
      assert.equal(getNextRun(file).enabled, true);
    });
  });

  it('reports disabled for a commented-out wake line', () => {
    withCronFile(`SHELL=/bin/bash\n# ${WAKE}\n`, (file) => {
      assert.equal(getNextRun(file).enabled, false);
    });
  });

  it('reports disabled for an INDENTED commented-out wake line', () => {
    // The comment test used to be anchored at column 0, so an indented "#" read
    // as a live schedule — and the tab favicon promised runs that were switched
    // off.
    withCronFile(`SHELL=/bin/bash\n  # ${WAKE}\n`, (file) => {
      assert.equal(getNextRun(file).enabled, false);
    });
  });

  it('reports disabled when there is no wake entry at all', () => {
    withCronFile('SHELL=/bin/bash\n0 3 * * * root /usr/bin/something-else\n', (file) => {
      assert.equal(getNextRun(file).enabled, false);
    });
  });

  it('leaves `enabled` out entirely when no cron file is installed', () => {
    // Nothing downstream may read a missing file as "switched off" — `installed`
    // already covers it, and faviconState only treats an explicit false as off.
    const result = getNextRun(path.join(os.tmpdir(), 'test-cron-does-not-exist'));
    assert.equal(result.installed, false);
    assert.equal('enabled' in result, false);
  });
});
