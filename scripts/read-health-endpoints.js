#!/usr/bin/env node
// scripts/read-health-endpoints.js — Read endpoint definitions for health-check.sh
//
// Usage: read-health-endpoints.js (--agent|--projects) <yaml-file>
//
// Both modes print {"pairs":[{"project","url","type"}, ...]} on stdout so the
// probe loop in health-check.sh is shape-agnostic. On a parse or shape error,
// prints PARSE_ERROR:<reason> on stderr and exits 1; health-check.sh turns that
// into its own "Failed to parse <file>" message.
//
// This parses with js-yaml — the portal's only runtime dependency — rather than
// shelling out to python3, which needs PyYAML that the system interpreter may
// not have (issue #304).

const fs = require('fs');
const yaml = require('js-yaml');

const [, , mode, file] = process.argv;

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOr(value, fallback) {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function pairsFromProjects(doc) {
  if (!isMapping(doc)) throw new Error('top-level must be a mapping');
  const projects = doc.projects === null || doc.projects === undefined ? [] : doc.projects;
  if (!Array.isArray(projects)) throw new Error('projects must be a list');

  const pairs = [];
  for (const project of projects) {
    if (!isMapping(project)) throw new Error('each project must be a mapping');
    const name = stringOr(project.name, '');
    const endpoints = project.endpoints;
    if (endpoints === null || endpoints === undefined) continue;
    if (!Array.isArray(endpoints)) throw new Error(`endpoints must be a list under project ${name}`);
    if (endpoints.length === 0) continue;
    for (const endpoint of endpoints) {
      if (!isMapping(endpoint)) throw new Error(`each endpoint must be a mapping under project ${name}`);
      pairs.push({ project: name, url: stringOr(endpoint.url, ''), type: stringOr(endpoint.type, '') });
    }
  }
  return pairs;
}

function pairsFromAgent(doc) {
  if (!isMapping(doc)) throw new Error('top-level must be a mapping');
  const name = stringOr(doc.name, '');
  const endpoints = doc.endpoints;
  if (endpoints === null || endpoints === undefined) return [];
  if (!Array.isArray(endpoints)) throw new Error('endpoints must be a list');
  return endpoints.map((endpoint) => ({
    project: name,
    url: isMapping(endpoint) ? stringOr(endpoint.url, '') : '',
    type: isMapping(endpoint) ? stringOr(endpoint.type, '') : '',
  }));
}

try {
  if (mode !== '--agent' && mode !== '--projects') {
    throw new Error('mode must be --agent or --projects');
  }
  if (!file) throw new Error('no file given');
  const doc = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  const pairs = mode === '--projects' ? pairsFromProjects(doc) : pairsFromAgent(doc);
  process.stdout.write(`${JSON.stringify({ pairs })}\n`);
} catch (error) {
  process.stderr.write(`PARSE_ERROR:${error.message}\n`);
  process.exit(1);
}
