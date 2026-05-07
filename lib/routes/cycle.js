// routes/cycle.js — /api/cron/toggle, /api/cron/schedule, /api/cycle/run, /api/cycle/respond
// Controls cron schedule and triggers wake cycles

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { sendJSON, readBody } = require('../helpers');
const { isCycleLocked, getNextRun } = require('../cron');
const { cronFromInterval, VALID_INTERVALS } = require('../cron-schedule');

// Build a clean env for spawning harness processes.
// For claude-code, removes CLAUDECODE to prevent nested-session interference.
// For other harness types, no cleanup needed.
function cleanHarnessEnv(config) {
  const env = { ...process.env };
  const harnessType = (config.harness && config.harness.type) || 'claude-code';
  if (harnessType === 'claude-code') {
    delete env.CLAUDECODE;
  }
  return env;
}

function register(routes, config) {
  const cronFile = config.cronFile;
  const lockFile = config.lockFile;
  const agentDir = config.agentDir;
  const frameworkDir = path.resolve(__dirname, '..', '..');

  // POST /api/cron/toggle — enable or disable the cron wake schedule
  routes['POST /api/cron/toggle'] = (req, res) => {
    if (!cronFile) {
      return sendJSON(res, 400, { error: 'No cron file configured' });
    }
    try {
      const content = fs.readFileSync(cronFile, 'utf-8');
      const lines = content.split('\n');
      const hasActive = lines.some(l => l.includes('wake.sh') && !l.startsWith('#'));
      const hasCommented = lines.some(l => l.startsWith('#') && l.includes('wake.sh'));

      let newLines;
      let enabled;
      if (hasActive) {
        // Disable: comment out the wake.sh line
        newLines = lines.map(l => (l.includes('wake.sh') && !l.startsWith('#')) ? '# ' + l : l);
        enabled = false;
      } else if (hasCommented) {
        // Enable: uncomment the wake.sh line
        newLines = lines.map(l => (l.startsWith('#') && l.includes('wake.sh')) ? l.replace(/^#\s*/, '') : l);
        enabled = true;
      } else {
        return sendJSON(res, 400, { error: 'No wake.sh entry found in cron file' });
      }

      fs.writeFileSync(cronFile, newLines.join('\n'));
      return sendJSON(res, 200, { ok: true, enabled });
    } catch (e) {
      return sendJSON(res, 500, { error: 'Failed to toggle cron: ' + e.message });
    }
  };

  // GET /api/cron/schedule — current cron expression + parsed interval/anchor + valid intervals
  routes['GET /api/cron/schedule'] = (req, res) => {
    if (!cronFile) {
      return sendJSON(res, 200, { error: 'No cron file configured', validIntervals: VALID_INTERVALS });
    }
    const info = getNextRun(cronFile);
    sendJSON(res, 200, {
      cron: info.cron,
      interval: info.interval,
      next: info.next,
      enabled: info.enabled,
      installed: info.installed,
      daemonRunning: info.daemonRunning,
      validIntervals: VALID_INTERVALS,
    });
  };

  // POST /api/cron/schedule — update the wake-cycle cron schedule via "every N hours, anchor at H:MM"
  routes['POST /api/cron/schedule'] = async (req, res) => {
    if (!cronFile) {
      return sendJSON(res, 400, { error: 'No cron file configured' });
    }
    if (!agentDir) {
      return sendJSON(res, 400, { error: 'No agentDir configured' });
    }
    const agentYaml = path.join(agentDir, 'agent.yaml');
    if (!fs.existsSync(agentYaml)) {
      return sendJSON(res, 400, { error: `agent.yaml not found at ${agentYaml}` });
    }

    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJSON(res, 400, { error: 'Invalid JSON body' });
    }

    const intervalHours = Number(body.intervalHours);
    const anchorHour = Number(body.anchorHour);
    const anchorMinute = Number(body.anchorMinute);

    let cronExpr;
    try {
      cronExpr = cronFromInterval({ intervalHours, anchorHour, anchorMinute });
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }

    try {
      execFileSync('node', [path.join(frameworkDir, 'scripts/read-config.js'), agentYaml, '--set', `cron-schedule=${cronExpr}`], { timeout: 5000 });
    } catch (e) {
      return sendJSON(res, 500, { error: 'Failed to update agent.yaml: ' + e.message });
    }

    try {
      execFileSync('bash', [path.join(frameworkDir, 'scripts/cron-setup.sh'), agentDir, 'install'], { timeout: 10000 });
    } catch (e) {
      return sendJSON(res, 500, { error: 'Failed to reinstall cron: ' + e.message });
    }

    const info = getNextRun(cronFile);
    sendJSON(res, 200, {
      ok: true,
      cron: cronExpr,
      interval: { intervalHours, anchorHour, anchorMinute },
      next: info.next,
    });
  };

  // POST /api/cycle/run — trigger a full wake cycle
  routes['POST /api/cycle/run'] = (req, res) => {
    if (isCycleLocked(lockFile)) {
      return sendJSON(res, 409, { ok: false, error: 'Cycle already running' });
    }
    const wakeScript = path.join(frameworkDir, 'scripts/wake.sh');
    try {
      // Write starting marker before spawn so status is immediately correct
      const markerFile = lockFile + '.starting';
      fs.writeFileSync(markerFile, String(process.pid));
      const cleanEnv = cleanHarnessEnv(config);
      const child = spawn('bash', [wakeScript, agentDir], {
        detached: true,
        stdio: 'ignore',
        cwd: agentDir,
        env: cleanEnv,
      });
      child.unref();
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      // Clean up marker on spawn failure
      try { fs.unlinkSync(lockFile + '.starting'); } catch {}
      return sendJSON(res, 500, { error: 'Failed to start cycle: ' + e.message });
    }
  };

  // POST /api/cycle/respond — trigger a respond-only cycle (if respond.sh exists)
  routes['POST /api/cycle/respond'] = (req, res) => {
    if (isCycleLocked(lockFile)) {
      return sendJSON(res, 409, { ok: false, error: 'Cycle already running' });
    }
    const respondScript = path.join(frameworkDir, 'scripts/respond.sh');
    try {
      // Write starting marker before spawn so status is immediately correct
      const markerFile = lockFile + '.starting';
      fs.writeFileSync(markerFile, String(process.pid));
      const cleanEnv2 = cleanHarnessEnv(config);
      const child = spawn('bash', [respondScript, agentDir], {
        detached: true,
        stdio: 'ignore',
        cwd: agentDir,
        env: cleanEnv2,
      });
      child.unref();
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      // Clean up marker on spawn failure
      try { fs.unlinkSync(lockFile + '.starting'); } catch {}
      return sendJSON(res, 500, { error: 'Failed to start respond cycle: ' + e.message });
    }
  };
}

module.exports = { register };
