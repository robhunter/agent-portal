// routes/status.js — /api/status, /api/next-run, /api/today

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { sendJSON } = require('../helpers');
const { getNextRun, isCycleLocked } = require('../cron');

function register(routes, config) {
  const agentDir = config.agentDir;
  const logsDir = path.join(agentDir, 'logs');

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
      services['cron'] = { installed: cronInfo.installed, daemonRunning: cronInfo.daemonRunning };
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
    } catch {
      status.lastWake = null;
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

module.exports = { register };
