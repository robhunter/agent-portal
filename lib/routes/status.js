// routes/status.js — /api/status, /api/next-run, /api/today

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { sendJSON, dataPath } = require('../helpers');
const { getNextRun, isCycleLocked } = require('../cron');
const yaml = require('js-yaml');

// The poller's own record of its last tick (scripts/poller.sh), or null when
// agent.yaml configures no poller. `stale` means the poller stopped ticking:
// a status file this old describes a loop that is no longer running.
function readPollerStatus(agentDir, logsDir) {
  let command;
  try {
    const doc = yaml.load(fs.readFileSync(path.join(agentDir, 'agent.yaml'), 'utf-8'));
    command = doc && doc.poll && doc.poll.command;
  } catch {
    return null;
  }
  if (!command) return null;
  let st;
  try {
    st = JSON.parse(fs.readFileSync(path.join(logsDir, 'poller-status.json'), 'utf-8'));
  } catch {
    return { command, running: false, stale: true, checkedAt: null };
  }
  const interval = Number(st.intervalSeconds) || 60;
  const ageS = st.checkedAt ? (Date.now() - new Date(st.checkedAt).getTime()) / 1000 : Infinity;
  // A tick can spend up to its command's timeout before it writes, so allow
  // three intervals plus that before calling the loop dead.
  const stale = !(ageS <= interval * 3 + 300);
  return { command, running: !stale, stale, ageSeconds: Number.isFinite(ageS) ? Math.round(ageS) : null, ...st };
}

function register(routes, config) {
  const agentDir = config.agentDir;
  // logs/ moves with dataDir; today.md and git ops stay at agentDir (operator-owned)
  const logsDir = dataPath(config, 'logs');

  routes['GET /api/status'] = (req, res) => {
    const status = {};
    const services = {};

    services['portal-server'] = {
      pid: process.pid,
      alive: true,
      uptime: Math.round((Date.now() - config._serverStartTime) / 1000),
    };

    if (config.cronFile) {
      const cronInfo = getNextRun(config.cronFile);
      // `enabled` is not the same fact as `installed`: switching cron off
      // comments the wake line out and leaves the file in place. Dropping it
      // here made every switched-off agent look scheduled.
      services['cron'] = {
        installed: cronInfo.installed,
        daemonRunning: cronInfo.daemonRunning,
        enabled: cronInfo.enabled,
      };
    }

    const poller = readPollerStatus(agentDir, logsDir);
    if (poller) {
      services['poller'] = { alive: poller.running, enabled: poller.enabled, pid: poller.pid };
      status.poller = poller;
    }

    status.services = services;

    if (config.lockFile) {
      status.cycleRunning = isCycleLocked(config.lockFile);
    }

    // Last wake event
    try {
      const eventsPath = path.join(logsDir, 'events.jsonl');
      const lines = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n').filter(Boolean);
      let lastWake = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const evt = JSON.parse(lines[i]);
          if (evt.type === 'cycle_start' || evt.type === 'cycle_end') {
            lastWake = evt;
            break;
          }
        } catch {}
      }
      status.lastWake = lastWake;

      // Did the most recent cycle end in an error? The harness logs `error` and
      // then still logs `cycle_end`, so the newest event on its own says nothing
      // about whether the work landed. Walk back to the newest cycle_start and
      // see whether an error beat us to it.
      let lastCycleErrored = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        let evt;
        try {
          evt = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (evt.type === 'error') {
          lastCycleErrored = true;
          break;
        }
        if (evt.type === 'cycle_start') {
          lastCycleErrored = false;
          break;
        }
      }
      status.lastCycleErrored = lastCycleErrored;
    } catch {
      status.lastWake = null;
      status.lastCycleErrored = null;
    }

    // Last auth confirmed
    try {
      const authFile = path.join(logsDir, '.auth-last-confirmed');
      const ts = fs.readFileSync(authFile, 'utf-8').trim();
      const confirmed = new Date(ts);
      const hoursAgo = Math.round((Date.now() - confirmed.getTime()) / 3600000 * 10) / 10;
      status.lastAuthConfirmed = { ts, hoursAgo };
    } catch {
      status.lastAuthConfirmed = null;
    }

    // Git info
    try {
      const head = execSync('git rev-parse --short HEAD', { cwd: agentDir, encoding: 'utf-8', timeout: 5000 }).trim();
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: agentDir, encoding: 'utf-8', timeout: 5000 }).trim();
      status.git = { head, branch };
    } catch {
      status.git = { head: null, branch: null };
    }

    status.serverTime = new Date().toISOString();
    sendJSON(res, 200, status);
  };

  routes['GET /api/next-run'] = (req, res) => {
    if (!config.cronFile) {
      return sendJSON(res, 200, { next: null, cron: null, error: 'No cron file configured', installed: false });
    }
    sendJSON(res, 200, getNextRun(config.cronFile));
  };

  routes['GET /api/today'] = (req, res) => {
    const todayPath = path.join(agentDir, 'today.md');
    try {
      const content = fs.readFileSync(todayPath, 'utf-8');
      sendJSON(res, 200, { content });
    } catch {
      sendJSON(res, 200, { content: '*No today.md found.*' });
    }
  };
}

module.exports = { register, readPollerStatus };
