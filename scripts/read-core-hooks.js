#!/usr/bin/env node
// scripts/read-core-hooks.js — Read core-hooks.yaml and output hook names for an extension point.
//
// Usage: node read-core-hooks.js <core-hooks.yaml> <extension-point>
// Output: one hook name per line (for grep -qx matching in run-hooks.sh)

const fs = require('fs');
const yaml = require('js-yaml');

const yamlPath = process.argv[2];
const extensionPoint = process.argv[3];

if (!yamlPath || !extensionPoint) {
  console.error('Usage: read-core-hooks.js <core-hooks.yaml> <extension-point>');
  process.exit(1);
}

const content = fs.readFileSync(yamlPath, 'utf8');
const doc = yaml.load(content);

const hooks = doc[extensionPoint];
if (Array.isArray(hooks)) {
  hooks.forEach(name => console.log(name));
}
