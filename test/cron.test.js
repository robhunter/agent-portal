const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { expandField } = require('../lib/cron');

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
