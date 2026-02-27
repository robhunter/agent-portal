// shell.js — HTML page builder for the agent portal SPA
// Assembles the complete HTML page from config, using modular UI components

const { getStyles } = require('./styles');
const { getClientCore } = require('./client-core');
const { getGitHubTabJS } = require('./tabs/github');
const { getRoadmapTabJS } = require('./tabs/roadmap');
const { getHealthTabJS } = require('./tabs/health');

/**
 * Build the full SPA HTML page string from config.
 *
 * Config fields used:
 * - name: Agent display name (e.g., "Coder")
 * - authors: { name: { color, bg } } for author badge styling
 * - features.github: if present, enables GitHub tab
 * - features.tabs: optional array of tab names to show (default: ["journal", "status"])
 */
function buildHTML(config) {
  const name = config.name || 'Agent';
  const authors = config.authors || {};

  // Determine which tabs to show
  const defaultTabs = ['journal', 'status'];
  if (config.features && config.features.github) {
    defaultTabs.splice(1, 0, 'github');
  }
  const tabs = (config.features && config.features.tabs) || defaultTabs;

  // Build tab HTML
  const tabsHTML = tabs.map((t, i) =>
    `<div class="tab${i === 0 ? ' active' : ''}" data-tab="${t}" onclick="switchTab('${t}')">${t.charAt(0).toUpperCase() + t.slice(1)}</div>`
  ).join('\n    ');

  // Collect tab JS modules — only include JS for tabs that are enabled
  let tabJS = '';
  const tabLoaderEntries = [
    `journal: loadJournal`,
    `status: loadStatus`,
  ];

  if (tabs.includes('github')) {
    tabJS += getGitHubTabJS();
    tabLoaderEntries.push(`github: loadGitHub`);
  }

  if (tabs.includes('roadmap')) {
    tabJS += getRoadmapTabJS();
    tabLoaderEntries.push(`roadmap: loadRoadmap`);
  }

  if (tabs.includes('health')) {
    tabJS += getHealthTabJS();
    tabLoaderEntries.push(`health: loadHealth`);
  }

  // Build the TAB_LOADERS map
  const tabLoadersJS = `const TAB_LOADERS = { ${tabLoaderEntries.join(', ')} };`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Agent Portal</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<style>
${getStyles(authors)}
</style>
</head>
<body>

<div id="sidebar">
  <div id="sidebar-header">
    <h1>${name}</h1>
    <span id="status-dot" class="status-dot status-red" title="Unknown"></span>
  </div>
  <div id="next-run">Next run: loading...</div>
  <div id="cron-toggle-wrap" style="padding:4px 16px 8px;display:none"><button id="cron-toggle-btn" class="refresh-btn" style="width:100%" onclick="toggleCron()">Loading...</button></div>
  <div style="padding:4px 16px 8px;display:flex;gap:6px">
    <button id="run-cycle-btn" class="refresh-btn" style="flex:1" onclick="runCycle()">Run Cycle</button>
    <button id="run-respond-btn" class="refresh-btn" style="flex:1" onclick="runRespond()">Respond</button>
  </div>
  <div id="cycle-status" style="padding:0 16px 8px;font-size:12px;display:none"><span id="cycle-status-text"></span></div>
  <div id="quick-stats">
    <span id="stat-issues" style="display:none">-- issues open</span>
    <span id="stat-prs" style="display:none">-- PRs open</span>
  </div>
</div>

<div id="main">
  <div id="tabs">
    ${tabsHTML}
  </div>
  <div id="content"><div class="empty">Loading...</div></div>
</div>

<script>
const PORTAL_CONFIG = ${JSON.stringify({ name, tabs, hasGitHub: !!(config.features && config.features.github) })};
${getClientCore()}
${tabJS}
${tabLoadersJS}

// --- Init ---
async function init() {
  await Promise.all([
    updateStatusDot(),
    loadNextRun(),
    loadQuickStats(),
  ]);
  switchTab(currentTab);
}

init();
setInterval(loadNextRun, 60000);
setInterval(updateStatusDot, 10000);
<\/script>
</body>
</html>`;
}

module.exports = { buildHTML };
