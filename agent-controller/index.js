const http = require('http');
const path = require('path');
const { load } = require('./lib/config');
const { createRouter } = require('./lib/routes');

const configPath = process.argv[2] || path.join(__dirname, 'agent-controller.yaml');

let config;
try {
  config = load(configPath);
} catch (err) {
  console.error(`Failed to load config: ${err.message}`);
  process.exit(1);
}

const handleRequest = createRouter(config);

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('Unhandled request error:', err);
    if (!res.writableEnded) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
    }
  });
});

const { host, port } = config.listen;
server.listen(port, host, () => {
  console.log(`Agent controller listening on ${host}:${port}`);
  console.log(`Managing ${Object.keys(config.agents).length} agents`);
});
