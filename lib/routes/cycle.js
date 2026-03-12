// routes/cycle.js — /api/cron/toggle, /api/cycle/run, /api/cycle/respond
// Controls cron schedule and triggers wake cycles

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sendJSON } = require('../helpers');
const { isCycleLocked } = require('../cron');

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
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;
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
      const cleanEnv2 = { ...process.env };
      delete cleanEnv2.CLAUDECODE;
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
