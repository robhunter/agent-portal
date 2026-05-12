#!/usr/bin/env node
// publish-content.js — Validate a drafted content item and either move it
// into <dataDir>/content/items/ (pass) or quarantine it under
// <dataDir>/content/rejected/ with a _validation block (fail).
//
// Usage: node publish-content.js <yaml-path> [--agent-dir <dir>] [--dry-run] [--skip-fetch]
// Typically invoked via scripts/publish-content.sh from an agent cycle.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { validateItem } = require('../lib/content-validator');

function parseArgs(argv) {
  const args = { positional: [], dryRun: false, skipFetch: false, agentDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--skip-fetch') args.skipFetch = true;
    else if (a === '--agent-dir') args.agentDir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else args.positional.push(a);
  }
  return args;
}

function usage(stream = process.stderr) {
  stream.write('Usage: publish-content.js <yaml-path> [--agent-dir <dir>] [--dry-run] [--skip-fetch]\n');
}

function readDataDirFromConfig(agentDir) {
  const cfgPath = path.join(agentDir, 'portal.config.json');
  try {
    const c = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    return c.dataDir || '.';
  } catch { return '.'; }
}

function formatErrors(errors) {
  return errors.map(e => {
    const url = e.url ? ` ${e.url}` : e.value ? ` ${JSON.stringify(e.value)}` : '';
    return `  - ${e.field}:${url} ${e.reason}`;
  }).join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.positional.length < 1) {
    usage(args.help ? process.stdout : process.stderr);
    process.exit(args.help ? 0 : 2);
  }

  const yamlPath = path.resolve(args.positional[0]);
  const agentDir = args.agentDir ? path.resolve(args.agentDir) : process.cwd();
  const dataDir = process.env.DATA_DIR || readDataDirFromConfig(agentDir);
  const dataRoot = path.join(agentDir, dataDir);
  const sourcesPath = path.join(dataRoot, 'config', 'sources.yaml');
  const itemsDir = path.join(dataRoot, 'content', 'items');
  const rejectedDir = path.join(dataRoot, 'content', 'rejected');

  // Load the draft YAML
  let item;
  try {
    item = yaml.load(fs.readFileSync(yamlPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(`Failed to read draft ${yamlPath}: ${err.message}\n`);
    process.exit(2);
  }

  // Load the sources registry
  let sources;
  try {
    const sourcesYaml = yaml.load(fs.readFileSync(sourcesPath, 'utf-8'));
    sources = (sourcesYaml && sourcesYaml.sources) || [];
  } catch (err) {
    process.stderr.write(`Failed to read sources registry ${sourcesPath}: ${err.message}\n`);
    process.exit(2);
  }

  const { ok, errors } = await validateItem(item, sources, { skipFetch: args.skipFetch });

  if (ok) {
    process.stdout.write(`PASS '${item.id}'\n`);
    if (args.dryRun) {
      process.stdout.write('(dry-run: no filesystem changes)\n');
      process.exit(0);
    }
    fs.mkdirSync(itemsDir, { recursive: true });
    const destPath = path.join(itemsDir, `${item.id}.yaml`);
    fs.writeFileSync(destPath, yaml.dump(item, { lineWidth: -1 }));
    if (path.resolve(yamlPath) !== path.resolve(destPath)) {
      try { fs.unlinkSync(yamlPath); } catch {}
    }
    process.stdout.write(`-> ${destPath}\n`);
    process.exit(0);
  }

  // Validation failed
  process.stderr.write(`FAIL '${item.id || '(no id)'}' (${errors.length} error${errors.length === 1 ? '' : 's'}):\n`);
  process.stderr.write(formatErrors(errors) + '\n');

  if (args.dryRun) {
    process.stderr.write('(dry-run: no filesystem changes)\n');
    process.exit(1);
  }

  fs.mkdirSync(rejectedDir, { recursive: true });
  const rejectedId = item.id || `unknown-${Date.now()}`;
  const rejectedPath = path.join(rejectedDir, `${rejectedId}.yaml`);
  const enriched = {
    ...item,
    _validation: { rejected_at: new Date().toISOString(), errors },
  };
  fs.writeFileSync(rejectedPath, yaml.dump(enriched, { lineWidth: -1 }));
  if (path.resolve(yamlPath) !== path.resolve(rejectedPath)) {
    try { fs.unlinkSync(yamlPath); } catch {}
  }
  process.stderr.write(`-> quarantined at ${rejectedPath}\n`);
  process.exit(1);
}

main().catch(err => {
  process.stderr.write(`Unexpected error: ${err.stack || err.message}\n`);
  process.exit(2);
});
