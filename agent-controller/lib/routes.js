const { verifyCaller, AuthError } = require('./auth');
const { checkPermission, listVisibleAgents } = require('./permissions');
const { getStatus, streamLogsArgs, lifecycleCommand, execArgs, cycleArgs } = require('./docker');
const { streamProcess } = require('./stream');
const { getAgent } = require('./config');
const url = require('url');

function createRouter(config) {
  const routes = {};

  function route(method, pattern, handler) {
    if (!routes[method]) routes[method] = [];
    // Convert :param patterns to regex
    const regex = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, '(?<$1>[^/]+)') + '$');
    routes[method].push({ regex, handler });
  }

  function match(method, url) {
    const pathname = url.split('?')[0];
    const methodRoutes = routes[method] || [];
    for (const { regex, handler } of methodRoutes) {
      const m = pathname.match(regex);
      if (m) return { handler, params: m.groups || {} };
    }
    return null;
  }

  // --- Routes ---

  route('GET', '/agents', async (req, res, { caller }) => {
    const visible = listVisibleAgents(config, caller.callerId);
    respond(res, 200, { ok: true, agents: visible });
  });

  route('GET', '/agents/:name/status', async (req, res, { caller, params }) => {
    const perm = checkPermission(config, caller.callerId, params.name, 'status');
    if (!perm.allowed) return respond(res, perm.statusCode, { ok: false, error: perm.reason });

    const agent = getAgent(config, params.name);
    const status = await getStatus(agent);
    respond(res, 200, { ok: true, agent: params.name, status });
  });

  route('GET', '/agents/:name/logs', async (req, res, { caller, params }) => {
    const perm = checkPermission(config, caller.callerId, params.name, 'logs');
    if (!perm.allowed) return respond(res, perm.statusCode, { ok: false, error: perm.reason });

    const agent = getAgent(config, params.name);
    const parsed = url.parse(req.url, true);
    const service = parsed.query.service || null;
    const tail = parsed.query.tail || '100';
    const args = streamLogsArgs(agent, service, tail);
    streamProcess(res, 'docker', args);
  });

  // --- Lifecycle routes (restart, stop, start) ---

  for (const op of ['restart', 'stop', 'start']) {
    route('POST', `/agents/:name/${op}`, async (req, res, { caller, params }) => {
      const perm = checkPermission(config, caller.callerId, params.name, op);
      if (!perm.allowed) return respond(res, perm.statusCode, { ok: false, error: perm.reason });

      const agent = getAgent(config, params.name);
      const result = await lifecycleCommand(agent, op);
      respond(res, result.ok ? 200 : 500, { ...result, agent: params.name, operation: op });
    });
  }

  // --- Exec route ---

  route('POST', '/agents/:name/exec', async (req, res, { caller, params }) => {
    const perm = checkPermission(config, caller.callerId, params.name, 'exec');
    if (!perm.allowed) return respond(res, perm.statusCode, { ok: false, error: perm.reason });

    const body = await readBody(req);
    if (!body.cmd || !Array.isArray(body.cmd) || body.cmd.length === 0) {
      return respond(res, 400, { ok: false, error: 'Request body must include cmd as a non-empty array' });
    }

    const agent = getAgent(config, params.name);
    const args = execArgs(agent, body.cmd);
    streamProcess(res, 'docker', args);
  });

  // --- Cycle route ---

  route('POST', '/agents/:name/cycle', async (req, res, { caller, params }) => {
    const perm = checkPermission(config, caller.callerId, params.name, 'cycle');
    if (!perm.allowed) return respond(res, perm.statusCode, { ok: false, error: perm.reason });

    const agent = getAgent(config, params.name);
    const args = cycleArgs(agent);
    streamProcess(res, 'docker', args);
  });

  // --- Request handler ---

  async function handleRequest(req, res) {
    // CORS and content type
    res.setHeader('Content-Type', 'application/json');

    const matched = match(req.method, req.url);
    if (!matched) {
      return respond(res, 404, { ok: false, error: 'Not found' });
    }

    try {
      const caller = await verifyCaller(req, config);
      await matched.handler(req, res, { caller, params: matched.params });
    } catch (err) {
      if (err instanceof AuthError) {
        return respond(res, err.statusCode, { ok: false, error: err.message });
      }
      console.error('Unhandled error:', err);
      respond(res, 500, { ok: false, error: 'Internal server error' });
    }
  }

  return handleRequest;
}

function respond(res, statusCode, body) {
  if (res.writableEnded) return;
  res.writeHead(statusCode);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = { createRouter };
