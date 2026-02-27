#!/usr/bin/env node
// index.js — Agent portal entry point
// Usage: agent-portal <config.json>

const fs = require('fs');
const path = require('path');
const { createServer, startServer } = require('./lib/server');

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

// TODO: Route modules will be registered here in subsequent PRs
// Each route module exports: register(routes, config)

// Build HTML page
function getHTML() {
  // Minimal placeholder HTML until UI modules are added in PR 3
  const name = config.name || 'Agent';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name} Portal</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; color: #333; }
    h1 { color: #1a73e8; }
  </style>
</head>
<body>
  <h1>${name} Portal</h1>
  <p>Portal is running. UI modules will be added in subsequent PRs.</p>
</body>
</html>`;
}

// Create and start server
const server = createServer(config, { routes, getHTML });
startServer(server, config);
