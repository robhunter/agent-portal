const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const VALID_PERMISSIONS = new Set([
  'rebuild', 'restart', 'stop', 'start', 'logs', 'status', 'exec', 'cycle',
]);

const VALID_DEPLOYMENTS = new Set(['sandcat', 'simple']);

function load(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = yaml.load(fs.readFileSync(configPath, 'utf8'));
  return validate(raw, configPath);
}

function validate(raw, configPath) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Config must be a YAML object');
  }

  if (!raw.agents_root || typeof raw.agents_root !== 'string') {
    throw new Error('Config missing required field: agents_root');
  }

  if (!raw.framework_dir || typeof raw.framework_dir !== 'string') {
    throw new Error('Config missing required field: framework_dir');
  }

  if (!raw.listen || typeof raw.listen !== 'string') {
    throw new Error('Config missing required field: listen');
  }

  const listenMatch = raw.listen.match(/^(.+):(\d+)$/);
  if (!listenMatch) {
    throw new Error(`Invalid listen format: ${raw.listen} (expected host:port)`);
  }

  if (!raw.auth || !raw.auth.callers || typeof raw.auth.callers !== 'object') {
    throw new Error('Config missing required field: auth.callers');
  }

  for (const [callerId, caller] of Object.entries(raw.auth.callers)) {
    if (!caller.uid || typeof caller.uid !== 'string') {
      throw new Error(`Caller '${callerId}' missing required field: uid`);
    }
    if (!caller.public_jwk) {
      throw new Error(`Caller '${callerId}' missing required field: public_jwk`);
    }
  }

  if (!raw.agents || typeof raw.agents !== 'object') {
    throw new Error('Config missing required field: agents');
  }

  const agents = {};
  for (const [name, agent] of Object.entries(raw.agents)) {
    if (!agent.dir || typeof agent.dir !== 'string') {
      throw new Error(`Agent '${name}' missing required field: dir`);
    }

    const controllable = agent.controllable !== false;

    if (agent.deployment && !VALID_DEPLOYMENTS.has(agent.deployment)) {
      throw new Error(`Agent '${name}' has invalid deployment: ${agent.deployment} (expected: ${[...VALID_DEPLOYMENTS].join(', ')})`);
    }

    if (controllable && (!agent.permissions || typeof agent.permissions !== 'object')) {
      throw new Error(`Agent '${name}' is controllable but has no permissions defined`);
    }

    const permissions = {};
    if (agent.permissions) {
      for (const [callerId, perms] of Object.entries(agent.permissions)) {
        if (!Array.isArray(perms)) {
          throw new Error(`Agent '${name}' permissions for '${callerId}' must be an array`);
        }
        for (const perm of perms) {
          if (!VALID_PERMISSIONS.has(perm)) {
            throw new Error(`Agent '${name}' has unknown permission '${perm}' for caller '${callerId}' (valid: ${[...VALID_PERMISSIONS].join(', ')})`);
          }
        }
        permissions[callerId] = new Set(perms);
      }
    }

    agents[name] = {
      name,
      dir: path.resolve(raw.agents_root, agent.dir),
      controllable,
      deployment: agent.deployment || 'sandcat',
      permissions,
    };
  }

  const callers = {};
  for (const [callerId, caller] of Object.entries(raw.auth.callers)) {
    const publicJwk = typeof caller.public_jwk === 'string'
      ? JSON.parse(caller.public_jwk)
      : caller.public_jwk;
    callers[caller.uid] = { callerId, uid: caller.uid, publicJwk };
  }

  return {
    listen: { host: listenMatch[1], port: parseInt(listenMatch[2], 10) },
    agentsRoot: raw.agents_root,
    frameworkDir: raw.framework_dir,
    agents,
    callers,
  };
}

function getAgent(config, name) {
  return config.agents[name] || null;
}

function getCallerByUid(config, uid) {
  return config.callers[uid] || null;
}

module.exports = { load, validate, getAgent, getCallerByUid, VALID_PERMISSIONS };
