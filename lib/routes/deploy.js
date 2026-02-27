// deploy.js — Deploy signal + service restart routes
// Registered when features.deploy or features.serviceRestart are configured

const fs = require('fs');
const path = require('path');
const { sendJSON } = require('../helpers');

function register(routes, config) {
  const agentDir = config.agentDir || '.';

  // POST /api/deploy — write deploy signal file
  if (config.features && config.features.deploy) {
    routes['POST /api/deploy'] = (req, res) => {
      const signalPath = config.features.deploySignalFile
        || path.join('/tmp', (config.name || 'agent').toLowerCase() + '-deploy-request');
      try {
        fs.writeFileSync(signalPath, new Date().toISOString());
        sendJSON(res, 202, { ok: true, message: 'Deploy requested. Supervisor will pick it up shortly.' });
      } catch (e) {
        sendJSON(res, 500, { error: 'Failed to write deploy signal: ' + e.message });
      }
    };
  }

  // POST /api/services/:name/restart — restart a named service
  if (config.features && config.features.serviceRestart) {
    const allowedServices = Array.isArray(config.features.serviceRestart)
      ? config.features.serviceRestart : [];

    routes['POST /api/services/:name/restart'] = (req, res) => {
      const name = req.params.name;
      if (!allowedServices.includes(name)) {
        return sendJSON(res, 400, {
          error: 'Unknown service: ' + name + '. Valid: ' + allowedServices.join(', '),
        });
      }

      // Special case: restarting the portal server itself
      if (name === config.name?.toLowerCase() + '-server' || name === 'portal-server') {
        sendJSON(res, 200, { ok: true, message: name + ' restarting...' });
        setTimeout(() => process.exit(0), 100);
        return;
      }

      // For other services, try to kill via PID file
      const pidFile = path.join('/tmp', name.replace(/\s/g, '-') + '.pid');
      try {
        if (fs.existsSync(pidFile)) {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
          process.kill(pid, 'SIGTERM');
          sendJSON(res, 200, { ok: true, message: name + ' restarting (killed PID ' + pid + ')...' });
        } else {
          sendJSON(res, 200, { ok: true, message: name + ' restart requested (no PID file found)' });
        }
      } catch (e) {
        sendJSON(res, 500, { error: 'Failed to restart ' + name + ': ' + e.message });
      }
    };
  }
}

module.exports = { register };
