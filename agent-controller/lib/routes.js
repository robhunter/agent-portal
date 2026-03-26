const { verifyCaller, AuthError } = require('./auth');
const { checkPermission, listVisibleAgents } = require('./permissions');
const { getStatus } = require('./docker');
const { getAgent } = require('./config');

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

module.exports = { createRouter };
