#!/usr/bin/env node
// index.js — Agent portal entry point
// Usage: agent-portal <config.json>
//
// ============================================================================
// Test PR — comment-only change to verify sandcat-paradigm PR flow.
// Content: recipe highlights from dinners-recipes-batch12-2026-04-14.md
// (Bobbo's latest dinner recommendations).
// ----------------------------------------------------------------------------
// 1. Indonesian Chicken Satay with Peanut Sauce (RecipeTin Eats, 4.97/5)
//    - Cuisine: Indonesian (new to rotation) | Gas grill | 35 min + marinate
//    - ~330 cal / 40g protein per serving (~4 skewers + sauce)
//    - Heartburn note: bird's-eye chilies omitted; sauce flavor stands without
//      heat via coconut milk, peanut butter, kecap manis, lime.
//    - Why: Indonesian cuisine was completely untouched; peanut sauce flavor
//      profile unlike anything currently in rotation.
//
// 2. Cedar Plank Salmon (Feasting At Home, 5/5)
//    - Cuisine: Pacific Northwest | Gas grill + cedar plank | 30 min + soak
//    - 192 cal / 25g protein — leanest recipe in the batch
//    - Heartburn note: zero spice heat; lemon zest + thyme only.
//    - Why: Rob already cooks salmon regularly but always oven/stovetop.
//      Cedar plank grilling is a genuinely new technique producing a
//      fundamentally different smoky, woodsy, moist result.
//
// 3. Cajun Garlic Butter Shrimp (The Recipe Critic, 4.75/5)
//    - Cuisine: Cajun/Southern (new) | Skillet | 10 min — fastest of any batch
//    - 263 cal / 24g protein
//    - Heartburn note: use mild cajun seasoning (paprika-forward, low
//      cayenne); at 1 tsp for 4 servings the heat is negligible.
//    - Why: Shrimp was the most underrepresented protein across 35 prior
//      recommendations; soy-brown-sugar-mustard-garlic echoes the Korean
//      pork HIT flavor building blocks.
//
// Batch summary:
//   - New cuisines: Indonesian, Cajun/Southern
//   - Proteins: Chicken, salmon, shrimp (broadest spread in any batch)
//   - Equipment: Gas grill ×2, skillet ×1
//   - All heartburn-safe, all bell-pepper-free
//
// Sources:
//   - https://www.recipetineats.com/satay-chicken-with-peanut-sauce/
//   - https://www.feastingathome.com/cedar-plank-salmon/
//   - https://therecipecritic.com/cajun-garlic-butter-shrimp/
// ============================================================================

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
