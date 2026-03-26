const { execFile } = require('child_process');
const path = require('path');
const os = require('os');

function composeFile(agentName, deployment) {
  if (deployment === 'sandcat') {
    return path.join(os.homedir(), 'sandcat-stacks', agentName, 'docker-compose.yml');
  }
  return null;
}

function composeArgs(agentName, deployment) {
  const file = composeFile(agentName, deployment);
  if (!file) return [];
  return ['-f', file];
}

function getStatus(agent) {
  return new Promise((resolve, reject) => {
    const args = ['compose', ...composeArgs(agent.name, agent.deployment), 'ps', '--format', 'json'];
    execFile('docker', args, { encoding: 'utf8', timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        return resolve({ running: false, error: stderr.trim() || err.message, containers: [] });
      }
      try {
        // docker compose ps --format json outputs one JSON object per line
        const containers = stdout.trim().split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
        resolve({
          running: containers.some(c => c.State === 'running'),
          containers: containers.map(c => ({
            name: c.Name,
            service: c.Service,
            state: c.State,
            status: c.Status,
            health: c.Health || null,
          })),
        });
      } catch (parseErr) {
        resolve({ running: false, error: `Failed to parse docker output: ${parseErr.message}`, containers: [] });
      }
    });
  });
}

function streamLogsArgs(agent, service, tail) {
  const args = ['compose', ...composeArgs(agent.name, agent.deployment), 'logs', '--follow'];
  if (tail) args.push('--tail', String(tail));
  if (service) args.push(service);
  return args;
}

function lifecycleCommand(agent, operation) {
  return new Promise((resolve, reject) => {
    const ops = {
      restart: ['restart', 'agent'],
      stop: ['down'],
      start: ['up', '-d'],
    };
    const opArgs = ops[operation];
    if (!opArgs) return reject(new Error(`Unknown lifecycle operation: ${operation}`));

    const args = ['compose', ...composeArgs(agent.name, agent.deployment), ...opArgs];
    execFile('docker', args, { encoding: 'utf8', timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        return resolve({ ok: false, error: stderr.trim() || err.message });
      }
      resolve({ ok: true, output: (stdout + stderr).trim() });
    });
  });
}

function execArgs(agent, cmd) {
  return ['compose', ...composeArgs(agent.name, agent.deployment), 'exec', '-T', 'agent', ...cmd];
}

function cycleArgs(agent) {
  return execArgs(agent, ['bash', 'scripts/wake.sh']);
}

function rebuildScript(config, agent) {
  const scriptName = agent.deployment === 'sandcat' ? 'docker-compose-create.sh' : 'docker-create.sh';
  return {
    command: 'bash',
    args: [path.join(config.frameworkDir, 'scripts', scriptName), agent.dir],
  };
}

// Simple in-memory job store for async rebuilds
const jobs = new Map();
let jobCounter = 0;

function createJob(agentName) {
  const id = `rb-${++jobCounter}-${Date.now()}`;
  const job = { id, agent: agentName, status: 'running', output: [], startedAt: new Date().toISOString() };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

module.exports = { getStatus, composeFile, composeArgs, streamLogsArgs, lifecycleCommand, execArgs, cycleArgs, rebuildScript, createJob, getJob };
