#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

async function main() {
  let outcome;
  for await (const line of readline.createInterface({
    input: fs.createReadStream(process.argv[2]),
    crlfDelay: Infinity,
  })) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === 'turn.started' || event.type === 'turn.failed' || event.type === 'turn.completed') {
      outcome = event.type;
    } else if (event.type === 'error') {
      outcome = 'error';
    }
  }
  if (outcome !== 'turn.completed') {
    throw new Error(`Codex did not complete its turn (${outcome || 'no lifecycle events'})`);
  }
}

main().catch((error) => {
  console.error(`[codex-harness] ${error.message}`);
  process.exitCode = 1;
});
