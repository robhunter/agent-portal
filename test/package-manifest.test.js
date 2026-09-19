const { describe, it } = require('node:test');
const assert = require('node:assert');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

describe('package manifest', () => {
  it('states one version across package.json and the lockfile', () => {
    assert.strictEqual(lock.version, pkg.version,
      'package-lock.json states a different version from package.json — run `npm install` and commit the lockfile with the bump');
    assert.strictEqual(lock.packages[''].version, pkg.version,
      "package-lock.json's root entry states a different version from package.json");
  });

  it('names the same package in both files', () => {
    assert.strictEqual(lock.name, pkg.name);
    assert.strictEqual(lock.packages[''].name, pkg.name);
  });
});
