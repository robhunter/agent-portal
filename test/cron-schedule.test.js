const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cronFromInterval, intervalFromCron, VALID_INTERVALS } = require('../lib/cron-schedule');

describe('cronFromInterval', () => {
  it('every 2 hours, anchor 00:00', () => {
    assert.equal(
      cronFromInterval({ intervalHours: 2, anchorHour: 0, anchorMinute: 0 }),
      '0 0,2,4,6,8,10,12,14,16,18,20,22 * * *'
    );
  });

  it('every 2 hours, anchor 11:00 — yields odd hours', () => {
    assert.equal(
      cronFromInterval({ intervalHours: 2, anchorHour: 11, anchorMinute: 0 }),
      '0 1,3,5,7,9,11,13,15,17,19,21,23 * * *'
    );
  });

  it('every 1 hour, anchor 0:30', () => {
    assert.equal(
      cronFromInterval({ intervalHours: 1, anchorHour: 0, anchorMinute: 30 }),
      '30 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23 * * *'
    );
  });

  it('every 24 hours, anchor 11:00 — single hour', () => {
    assert.equal(
      cronFromInterval({ intervalHours: 24, anchorHour: 11, anchorMinute: 0 }),
      '0 11 * * *'
    );
  });

  it('every 12 hours, anchor 8:15', () => {
    assert.equal(
      cronFromInterval({ intervalHours: 12, anchorHour: 8, anchorMinute: 15 }),
      '15 8,20 * * *'
    );
  });

  it('rejects non-divisor interval', () => {
    assert.throws(
      () => cronFromInterval({ intervalHours: 5, anchorHour: 0, anchorMinute: 0 }),
      /intervalHours must be one of/
    );
  });

  it('rejects out-of-range anchor hour', () => {
    assert.throws(
      () => cronFromInterval({ intervalHours: 2, anchorHour: 24, anchorMinute: 0 }),
      /anchorHour must be 0-23/
    );
  });

  it('rejects out-of-range anchor minute', () => {
    assert.throws(
      () => cronFromInterval({ intervalHours: 2, anchorHour: 0, anchorMinute: 60 }),
      /anchorMinute must be 0-59/
    );
  });

  it('rejects non-integer interval', () => {
    assert.throws(
      () => cronFromInterval({ intervalHours: 2.5, anchorHour: 0, anchorMinute: 0 }),
      /intervalHours must be one of/
    );
  });
});

describe('intervalFromCron', () => {
  it('parses every-2-hours starting at 00', () => {
    assert.deepEqual(
      intervalFromCron('0 0,2,4,6,8,10,12,14,16,18,20,22 * * *'),
      { intervalHours: 2, anchorHour: 0, anchorMinute: 0 }
    );
  });

  it('parses every-2-hours starting at odd hours', () => {
    assert.deepEqual(
      intervalFromCron('0 1,3,5,7,9,11,13,15,17,19,21,23 * * *'),
      { intervalHours: 2, anchorHour: 1, anchorMinute: 0 }
    );
  });

  it('parses single-hour cron (every 24h)', () => {
    assert.deepEqual(
      intervalFromCron('30 11 * * *'),
      { intervalHours: 24, anchorHour: 11, anchorMinute: 30 }
    );
  });

  it('parses */N step expression as interval N', () => {
    assert.deepEqual(
      intervalFromCron('0 */6 * * *'),
      { intervalHours: 6, anchorHour: 0, anchorMinute: 0 }
    );
  });

  it('parses every-hour wildcard as interval 1', () => {
    assert.deepEqual(
      intervalFromCron('5 * * * *'),
      { intervalHours: 1, anchorHour: 0, anchorMinute: 5 }
    );
  });

  it('returns null for non-divisor interval pattern', () => {
    // Every 5 hours starting at 0: 0,5,10,15,20 — gap of 4 hours back to anchor
    assert.equal(intervalFromCron('0 0,5,10,15,20 * * *'), null);
  });

  it('returns null for non-wildcard day', () => {
    assert.equal(intervalFromCron('0 0,12 * * 1'), null);
  });

  it('returns null for missing fields', () => {
    assert.equal(intervalFromCron('0 0,12'), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(intervalFromCron(null), null);
    assert.equal(intervalFromCron(undefined), null);
    assert.equal(intervalFromCron(42), null);
  });

  it('round-trips all valid intervals', () => {
    for (const N of VALID_INTERVALS) {
      for (const anchorHour of [0, 5, 11, 23]) {
        for (const anchorMinute of [0, 17, 59]) {
          const expr = cronFromInterval({ intervalHours: N, anchorHour, anchorMinute });
          const parsed = intervalFromCron(expr);
          assert.equal(parsed.intervalHours, N, `N=${N} h=${anchorHour} m=${anchorMinute} should parse to N=${N}`);
          assert.equal(parsed.anchorMinute, anchorMinute);
          // anchorHour might canonicalize to first hour in the schedule
          const diff = ((parsed.anchorHour - anchorHour) % N + N) % N;
          assert.equal(diff, 0,
            `anchor mod N should match: parsed=${parsed.anchorHour} input=${anchorHour} N=${N}`);
        }
      }
    }
  });
});

describe('VALID_INTERVALS', () => {
  it('contains the 8 divisors of 24', () => {
    assert.deepEqual(VALID_INTERVALS, [1, 2, 3, 4, 6, 8, 12, 24]);
  });
});
