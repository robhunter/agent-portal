// server.js — HTTP server creation, routing, PID management
// No external dependencies — uses Node built-in modules only

const http = require('http');
const fs = require('fs');
const { sendJSON } = require('./helpers');

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
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // API routes
    if (pathname.startsWith('/api/')) {
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
