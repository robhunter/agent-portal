// lib/harness-select.js — which harness the next cycle runs.
//
// portal.config.json `harness.type` is the default and `harness.types` lists
// the harnesses an agent can run. A one-word override file in the agent
// directory (.harness-override, gitignored by each agent) selects another
// listed type without touching committed config — Flenderson writes it when
// someone flips the harness dropdown. scripts/read-harness-config.sh applies
// the same rule for the cycle scripts; keep the two in step.

const fs = require('fs');
const path = require('path');

const OVERRIDE_FILE = '.harness-override';

function harnessConfig(config) {
  return (config && config.harness) || {};
}

function defaultType(config) {
  return harnessConfig(config).type || 'claude-code';
}

function harnessTypes(config) {
  const h = harnessConfig(config);
  return Array.isArray(h.types) && h.types.length ? h.types : [defaultType(config)];
}

// Switching only means something when the framework launches the harness
// itself. An agent with its own `harness.command` wrapper picks the harness
// inside that wrapper (fleethd-coder by work-item tag, for example).
function isSwitchable(config) {
  return harnessTypes(config).length > 1 && !harnessConfig(config).command;
}

function readOverride(agentDir) {
  if (!agentDir) return null;
  try {
    return fs.readFileSync(path.join(agentDir, OVERRIDE_FILE), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function selectedType(config) {
  const override = isSwitchable(config) ? readOverride(config.agentDir) : null;
  return override && harnessTypes(config).includes(override) ? override : defaultType(config);
}

module.exports = { OVERRIDE_FILE, defaultType, harnessTypes, isSwitchable, readOverride, selectedType };
