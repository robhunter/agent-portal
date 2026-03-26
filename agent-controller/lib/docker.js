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

module.exports = { getStatus, composeFile, composeArgs, streamLogsArgs };
