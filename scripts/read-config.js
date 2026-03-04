#!/usr/bin/env node
// scripts/read-config.js — Read agent.yaml and output shell-friendly variables.
//
// Usage:
//   eval "$(node read-config.js /path/to/agent.yaml)"
//   node read-config.js /path/to/agent.yaml --set key=value

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const args = process.argv.slice(2);
const yamlPath = args[0];

if (!yamlPath) {
  console.error('Usage: read-config.js <agent.yaml> [--set key=value]');
  process.exit(1);
}

// --set mode: update a single key in the YAML file
const setArg = args.find(a => a.startsWith('--set'));
if (setArg !== undefined) {
  const setIdx = args.indexOf('--set');
  const kvArg = args[setIdx + 1] || args.find(a => a.startsWith('--set='))?.slice(6);
  let key, value;

  if (args[setIdx] === '--set' && args[setIdx + 1]) {
    [key, ...rest] = args[setIdx + 1].split('=');
    value = rest.join('=');
  } else if (args[setIdx].startsWith('--set=')) {
    [key, ...rest] = args[setIdx].slice(6).split('=');
    value = rest.join('=');
  }

  if (!key) {
    console.error('Usage: read-config.js <agent.yaml> --set key=value');
    process.exit(1);
  }

  const content = fs.readFileSync(yamlPath, 'utf8');
  const doc = yaml.load(content);
  doc[key] = value === 'null' ? null : value;
  fs.writeFileSync(yamlPath, yaml.dump(doc, { lineWidth: -1, quotingType: '"' }));
  process.exit(0);
}

// Read mode: output shell variables
const content = fs.readFileSync(yamlPath, 'utf8');
const doc = yaml.load(content);

// Shell-escape a value for safe eval
function shellEscape(val) {
  if (val === null || val === undefined) return '""';
  const s = String(val);
  // Single-quote the value, escaping any embedded single quotes
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// Scalar values
const scalars = {
  AGENT_NAME: doc.name,
  AGENT_REPO: doc.repo,
  AGENT_PORT: doc.port,
  AGENT_LOCK_FILE: doc['lock-file'],
  AGENT_CRON_FILE: doc['cron-file'],
  AGENT_CRON_SCHEDULE: doc['cron-schedule'],
  FRAMEWORK_LAST_KNOWN_GOOD: doc['framework-last-known-good'],
};

for (const [key, val] of Object.entries(scalars)) {
  console.log(`${key}=${shellEscape(val)}`);
}

// Multi-line values — write to temp files, output paths
const agentName = doc.name || 'agent';

if (doc['wake-prompt']) {
  const promptPath = `/tmp/agent-${agentName}-wake-prompt.txt`;
  fs.writeFileSync(promptPath, doc['wake-prompt']);
  console.log(`WAKE_PROMPT_FILE=${shellEscape(promptPath)}`);
} else {
  console.log('WAKE_PROMPT_FILE=""');
}

if (doc['respond-prompt']) {
  const promptPath = `/tmp/agent-${agentName}-respond-prompt.txt`;
  fs.writeFileSync(promptPath, doc['respond-prompt']);
  console.log(`RESPOND_PROMPT_FILE=${shellEscape(promptPath)}`);
} else {
  console.log('RESPOND_PROMPT_FILE=""');
}

// Array values — indexed variables
const workspaces = doc.workspaces || [];
console.log(`WORKSPACES_COUNT=${workspaces.length}`);
workspaces.forEach((ws, i) => {
  console.log(`WORKSPACE_${i}_REPO=${shellEscape(ws.repo)}`);
  console.log(`WORKSPACE_${i}_PATH=${shellEscape(ws.path)}`);
  console.log(`WORKSPACE_${i}_NPM_INSTALL=${shellEscape(ws['npm-install'] ? 'true' : 'false')}`);
});

const extraCron = doc['extra-cron'] || [];
console.log(`EXTRA_CRON_COUNT=${extraCron.length}`);
extraCron.forEach((entry, i) => {
  console.log(`EXTRA_CRON_${i}_SCHEDULE=${shellEscape(entry.schedule)}`);
  console.log(`EXTRA_CRON_${i}_COMMAND=${shellEscape(entry.command)}`);
  console.log(`EXTRA_CRON_${i}_LOG=${shellEscape(entry.log)}`);
});
