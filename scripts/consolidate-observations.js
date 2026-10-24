#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const yaml = require('js-yaml');

try {
  const block = yaml.load(fs.readFileSync(0, 'utf8'), { schema: yaml.JSON_SCHEMA });
  if (!block || typeof block !== 'object' || Array.isArray(block) ||
      !Array.isArray(block.new_learnings)) {
    throw new Error('expected a new_learnings list');
  }
  const observations = block.new_learnings.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.observation !== 'string' || !item.observation.trim()) {
      throw new Error('each learning must contain nonempty observation text');
    }
    return item.observation;
  });
  process.stdout.write(JSON.stringify(observations));
} catch (error) {
  console.error(`Invalid consolidation learnings: ${error.message}`);
  process.exitCode = 1;
}
