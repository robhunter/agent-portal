// server.js — HTTP server creation, routing, PID management
// No external dependencies — uses Node built-in modules only

const http = require('http');
const fs = require('fs');
const { sendJSON } = require('./helpers');

// --- Response cache for GET /api/ routes ---
// Short TTL cache to avoid redundant file I/O on rapid/parallel requests
const CACHE_TTL_MS = 10000; // 10 seconds

function createResponseCache() {
  const store = {};

  return {
    get(key) {
      const entry = store[key];
      if (entry && (Date.now() - entry.ts) < CACHE_TTL_MS) {
        return entry;
      }
      delete store[key];
      return null;
    },
    set(key, statusCode, body) {
      store[key] = { ts: Date.now(), statusCode, body };
    },
    invalidate(pathname) {
      for (const key of Object.keys(store)) {
        if (key.startsWith(pathname) || pathname.startsWith(key)) {
          delete store[key];
        }
      }
    },
  };
}

/**
 * Create and configure the portal HTTP server.
 *
 * @param {object} config - The portal configuration object
 * @param {object} options
 * @param {object} options.routes - Map of "METHOD /path" to handler functions
 * @param {function} options.getHTML - Function that returns the SPA HTML string
 * @returns {http.Server}
 */
function createServer(config, { routes, getHTML }) {
  const cache = createResponseCache();
  const allowedUsers = config.auth && config.auth.allowedUsers;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Tailscale identity auth (skip if allowedUsers not configured)
    if (allowedUsers && allowedUsers.length > 0) {
      // Exempt health endpoint from auth
      if (pathname !== '/api/health') {
        const userLogin = req.headers['tailscale-user-login'];
        if (!userLogin) {
          sendJSON(res, 401, { error: 'Unauthorized — no identity header' });
          return;
        }
        if (!allowedUsers.includes(userLogin)) {
          sendJSON(res, 403, { error: 'Forbidden' });
          return;
        }
        // Attach user info for downstream use
        req.tailscaleUser = {
          login: userLogin,
          name: req.headers['tailscale-user-name'] || userLogin,
        };
      }
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      // For mutating requests, invalidate related cache entries
      if (req.method !== 'GET') {
        cache.invalidate(pathname);
      }

      // For GET requests, check response cache
      // Skip caching for lightweight/frequently-polled endpoints
      const skipCache = pathname === '/api/badges' || pathname === '/api/status'
        || pathname === '/api/next-run' || pathname === '/api/claude/status';
      if (req.method === 'GET' && !skipCache) {
        const cacheKey = pathname + url.search;
        const cached = cache.get(cacheKey);
        if (cached) {
          res.writeHead(cached.statusCode, { 'Content-Type': 'application/json' });
          res.end(cached.body);
          return;
        }

        // Intercept sendJSON to capture response for caching
        const origEnd = res.end.bind(res);
        res.end = function(body) {
          // Cache if writeHead was called with 2xx (check res.statusCode)
          if (res.statusCode >= 200 && res.statusCode < 300 && typeof body === 'string') {
            cache.set(cacheKey, res.statusCode, body);
          }
          return origEnd(body);
        };
      }

      const routeKey = `${req.method} ${pathname}`;

      // Exact match first
      if (routes[routeKey]) {
        try {
          await routes[routeKey](req, res, url);
        } catch (err) {
          console.error(`Route error [${routeKey}]:`, err.message);
          sendJSON(res, 500, { error: 'Internal server error' });
        }
        return;
      }

      // Pattern match for parameterized routes (e.g., /api/projects/:slug/journal)
      for (const [pattern, handler] of Object.entries(routes)) {
        const match = matchRoute(pattern, `${req.method} ${pathname}`);
        if (match) {
          req.params = match;
          try {
            await handler(req, res, url);
          } catch (err) {
            console.error(`Route error [${pattern}]:`, err.message);
            sendJSON(res, 500, { error: 'Internal server error' });
          }
          return;
        }
      }

      sendJSON(res, 404, { error: 'Not found' });
      return;
    }

    // SPA fallback — serve the HTML page for all non-API routes
    const html = getHTML();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  return server;
}

/**
 * Match a route pattern against a request.
 * Supports :param placeholders (e.g., "GET /api/projects/:slug/journal").
 * Returns an object of param values on match, or null.
 */
function matchRoute(pattern, request) {
  const [patMethod, patPath] = pattern.split(' ', 2);
  const [reqMethod, reqPath] = request.split(' ', 2);

  if (patMethod !== reqMethod) return null;

  const patParts = patPath.split('/');
  const reqParts = reqPath.split('/');

  if (patParts.length !== reqParts.length) return null;

  const params = {};
  for (let i = 0; i < patParts.length; i++) {
    if (patParts[i].startsWith(':')) {
      params[patParts[i].slice(1)] = decodeURIComponent(reqParts[i]);
    } else if (patParts[i] !== reqParts[i]) {
      return null;
    }
  }

  return params;
}

/**
 * Write PID file and set up cleanup on exit.
 */
function setupPidFile(pidFile) {
  fs.writeFileSync(pidFile, String(process.pid));

  const cleanup = () => {
    try { fs.unlinkSync(pidFile); } catch {}
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
}

/**
 * Start the server: write PID, listen on port, log readiness.
 */
function startServer(server, config) {
  if (config.pidFile) {
    setupPidFile(config.pidFile);
  }

  const port = config.port || 8080;
  server.listen(port, () => {
    console.log(`${config.name || 'Agent'} portal listening on port ${port}`);
  });

  return server;
}

module.exports = { createServer, startServer, matchRoute, setupPidFile };
