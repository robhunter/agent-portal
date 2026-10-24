#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const yaml = require('js-yaml');

try {
  let text = fs.readFileSync(0, 'utf8');
  let insights = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  if (insights && Object.hasOwn(insights, 'consolidated-insights')) {
    insights = insights['consolidated-insights'];
    text = yaml.dump(insights, { lineWidth: -1 });
  }
  if (!insights || typeof insights !== 'object' || Array.isArray(insights)) {
    throw new Error('expected an insights mapping');
  }
  const timestamp = insights.last_consolidated;
  if (typeof timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp)) ||
      new Date(`${timestamp.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== timestamp.slice(0, 10)) {
    throw new Error('last_consolidated must be an ISO timestamp with a timezone');
  }
  const expectedTimestamp = process.argv[2];
  if (!expectedTimestamp || Date.parse(timestamp) !== Date.parse(expectedTimestamp)) {
    throw new Error('last_consolidated must match the requested processing timestamp');
  }
  if (typeof insights.summary !== 'string' || !insights.summary.trim()) {
    throw new Error('summary must be nonempty text');
  }
  for (const key of ['recurring_themes', 'key_decisions', 'active_patterns', 'stale_learnings']) {
    if (Object.hasOwn(insights, key) && !Array.isArray(insights[key])) {
      throw new Error(`${key} must be a list`);
    }
  }
  process.stdout.write(text);
} catch (error) {
  console.error(`Invalid consolidation insights: ${error.message}`);
  process.exitCode = 1;
}
