const { getAgent } = require('./config');

class PermissionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermissionError';
    this.statusCode = 403;
  }
}

function checkPermission(config, callerId, agentName, operation) {
  const agent = getAgent(config, agentName);

  if (!agent) {
    return { allowed: false, reason: `Unknown agent: ${agentName}`, statusCode: 404 };
  }

  if (!agent.controllable) {
    return { allowed: false, reason: `Agent '${agentName}' is not controllable`, statusCode: 403 };
  }

  if (!Object.prototype.hasOwnProperty.call(agent.permissions, callerId)) {
    return { allowed: false, reason: `Caller '${callerId}' has no permissions on agent '${agentName}'`, statusCode: 403 };
  }
  const callerPerms = agent.permissions[callerId];

  if (!callerPerms.has(operation)) {
    return { allowed: false, reason: `Caller '${callerId}' cannot '${operation}' agent '${agentName}'`, statusCode: 403 };
  }

  return { allowed: true };
}

function listVisibleAgents(config, callerId) {
  const visible = [];
  for (const [name, agent] of Object.entries(config.agents)) {
    if (!agent.controllable) continue;
    if (!Object.prototype.hasOwnProperty.call(agent.permissions, callerId)) continue;
    const callerPerms = agent.permissions[callerId];
    if (!callerPerms || callerPerms.size === 0) continue;
    visible.push({
      name,
      permissions: [...callerPerms],
    });
  }
  return visible;
}

module.exports = { checkPermission, listVisibleAgents, PermissionError };
