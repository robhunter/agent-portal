#!/usr/bin/env node
// index.js — Agent portal entry point
// Usage: agent-portal <config.json>

const fs = require('fs');
const path = require('path');
const { createServer, startServer } = require('./lib/server');
const { buildHTML } = require('./lib/ui');

// Load config from CLI argument
const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: agent-portal <config.json>');
  process.exit(1);
}

const resolvedConfigPath = path.resolve(configPath);
let config;
try {
  config = JSON.parse(fs.readFileSync(resolvedConfigPath, 'utf-8'));
} catch (err) {
  console.error(`Failed to load config from ${resolvedConfigPath}: ${err.message}`);
  process.exit(1);
}

// Resolve agentDir relative to config file location if not absolute
if (config.agentDir && !path.isAbsolute(config.agentDir)) {
  config.agentDir = path.resolve(path.dirname(resolvedConfigPath), config.agentDir);
}

// Ensure required directories exist
const agentDir = config.agentDir;
if (agentDir) {
  const journalsDir = path.join(agentDir, 'journals');
  const logsDir = path.join(agentDir, 'logs');
  for (const dir of [journalsDir, logsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Record server start time on config for status reporting
config._serverStartTime = Date.now();

// Collect routes from route modules
const routes = {};

// Register core route modules
require('./lib/routes/status').register(routes, config);
require('./lib/routes/journal').register(routes, config);
require('./lib/routes/events').register(routes, config);
require('./lib/routes/github').register(routes, config);
require('./lib/routes/cycle').register(routes, config);
require('./lib/routes/roadmap').register(routes, config);
require('./lib/routes/health').register(routes, config);
require('./lib/routes/requests').register(routes, config);
require('./lib/routes/projects').register(routes, config);
require('./lib/routes/outputs').register(routes, config);
require('./lib/routes/deploy').register(routes, config);
require('./lib/routes/claude').register(routes, config);
require('./lib/routes/uploads').register(routes, config);
require('./lib/routes/todos').register(routes, config);
require('./lib/routes/badges').register(routes, config);
require('./lib/routes/capabilities').register(routes, config);
require('./lib/routes/tts').register(routes, config);

// Build HTML page (cached — config doesn't change at runtime)
let cachedHTML;
function getHTML() {
  if (!cachedHTML) cachedHTML = buildHTML(config);
  return cachedHTML;
}

// Create and start server
const server = createServer(config, { routes, getHTML });
startServer(server, config);
