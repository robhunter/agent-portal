// shell.js — HTML page builder for the agent portal SPA
// Assembles the complete HTML page from config, using modular UI components

const { execSync } = require('child_process');
const path = require('path');
const pkg = require('../../package.json');
const { version } = pkg;
const { getStyles } = require('./styles');

// Capture git commit at module load time (once, cached for server lifetime)
let gitCommit = null;
try {
  const repoRoot = path.resolve(__dirname, '..', '..');
  gitCommit = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8', timeout: 5000 }).trim();
} catch {
  // Not a git repo or git not available — graceful degradation
}
const { getClientCore } = require('./client-core');
const { getGitHubTabJS } = require('./tabs/github');
const { getRoadmapTabJS } = require('./tabs/roadmap');
const { getHealthTabJS } = require('./tabs/health');
const { getRequestsTabJS } = require('./tabs/requests');
const { getOutputsTabJS } = require('./tabs/outputs');
const { getTodosTabJS } = require('./tabs/todos');
const { getProjectSidebarJS } = require('./sidebar-projects');
const { getURLStateJS } = require('./url-state');

/**
 * Build the full SPA HTML page string from config.
 *
 * Config fields used:
 * - name: Agent display name (e.g., "Coder")
 * - authors: { name: { color, bg } } for author badge styling
 * - features.github: if present, enables GitHub tab
 * - features.tabs: optional array of tab names to show (default: ["journal", "status"])
 * - sidebar.type: "simple" (default) or "projects" (Bobbo-style project list)
 */
function buildHTML(config) {
  const name = config.name || 'Agent';
  const authors = config.authors || {};
  const sidebarType = (config.sidebar && config.sidebar.type) || 'simple';
  const hasRunningLog = sidebarType === 'projects' && config.sidebar && config.sidebar.runningLog;

  // Build version footer with optional commit link
  let versionFooter;
  if (gitCommit) {
    const shortHash = gitCommit.slice(0, 7);
    const repoUrl = (pkg.repository && pkg.repository.url || '').replace(/\.git$/, '');
    const commitUrl = repoUrl ? `${repoUrl}/commit/${gitCommit}` : '';
    if (commitUrl) {
      versionFooter = `<a href="${commitUrl}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none" title="${gitCommit}">Agent Portal v${version} (${shortHash})</a>`;
    } else {
      versionFooter = `<span title="${gitCommit}">Agent Portal v${version} (${shortHash})</span>`;
    }
  } else {
    versionFooter = `Agent Portal v${version}`;
  }

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

  if (tabs.includes('requests')) {
    tabJS += getRequestsTabJS();
    tabLoaderEntries.push(`requests: loadRequests`);
  }

  if (tabs.includes('outputs')) {
    tabJS += getOutputsTabJS();
    tabLoaderEntries.push(`outputs: loadOutputs`);
  }

  if (tabs.includes('todos')) {
    tabJS += getTodosTabJS();
    tabLoaderEntries.push(`todos: loadTodos`);
  }

  // Project sidebar support
  let projectSidebarJS = '';
  let urlStateJS = '';
  if (sidebarType === 'projects') {
    projectSidebarJS = getProjectSidebarJS();
    urlStateJS = getURLStateJS();
    // Override journal loader to use per-project journal when project selected
    tabLoaderEntries[0] = `journal: loadProjectJournal`;
    // Add project tab loader
    if (tabs.includes('project')) {
      tabLoaderEntries.push(`project: loadProjectFile`);
    }
  }

  // Build the TAB_LOADERS map
  const tabLoadersJS = `const TAB_LOADERS = { ${tabLoaderEntries.join(', ')} };`;

  // Build sidebar HTML based on type
  let sidebarHTML;
  if (sidebarType === 'projects') {
    sidebarHTML = `<div id="sidebar">
  <h1>${name}</h1>
  <div id="next-run">Next run: loading...</div>
  <div id="claude-status" style="font-size:12px;padding:0 16px 8px;color:#888">Claude: checking...</div>
  <div id="cron-toggle-wrap" style="padding:4px 16px 8px;display:none"><button id="cron-toggle-btn" class="refresh-btn" style="width:100%" onclick="toggleCron()">Loading...</button></div>
  <div style="padding:4px 16px 8px;display:flex;gap:6px">
    <button id="run-cycle-btn" class="refresh-btn" style="flex:1" onclick="runCycle()">Run Cycle</button>
    <button id="run-respond-btn" class="refresh-btn" style="flex:1" onclick="runRespond()">Respond</button>
  </div>
  <div id="cycle-status" style="padding:0 16px 8px;font-size:12px;display:none"><span id="cycle-status-text"></span></div>
  ${hasRunningLog ? `<div id="bobbo-log-item" class="project-item active" onclick="selectBobboLog()">
    <div class="title">Running Log</div>
    <div class="meta">Cross-project cycle log</div>
  </div>` : ''}
  <div id="project-list"></div>
  <div id="sidebar-footer">${versionFooter}</div>
</div>`;
  } else {
    sidebarHTML = `<div id="sidebar">
  <div id="sidebar-header">
    <h1>${name}</h1>
    <span id="status-dot" class="status-dot status-red" title="Unknown"></span>
  </div>
  <div id="next-run">Next run: loading...</div>
  <div id="claude-status" style="font-size:12px;padding:0 16px 8px;color:#888">Claude: checking...</div>
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
  <div id="sidebar-footer">${versionFooter}</div>
</div>`;
  }

  // Build init function based on sidebar type
  let initJS;
  if (sidebarType === 'projects') {
    initJS = `async function init() {
  await loadProjects();
  await Promise.all([loadNextRun(), updateStatusDot(), updateClaudeStatus()]);
  const params = new URLSearchParams(window.location.search);
  if (params.get('project') || params.get('view')) {
    await initFromURL();
  } else {
    ${hasRunningLog ? 'await selectBobboLog();' : 'if (projects.length > 0) await selectProject(projects[0].slug);'}
  }
}`;
  } else {
    initJS = `async function init() {
  await Promise.all([
    updateStatusDot(),
    loadNextRun(),
    loadQuickStats(),
    updateClaudeStatus(),
  ]);
  switchTab(currentTab);
}`;
  }

  const portalConfig = {
    name,
    tabs,
    hasGitHub: !!(config.features && config.features.github),
    sidebarType,
  };

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

${sidebarHTML}

<div id="sidebar-overlay" onclick="closeSidebar()"></div>

<div id="main">
  <div id="tabs">
    <button id="menu-btn" onclick="toggleSidebar()" aria-label="Menu">&#9776;</button>
    ${tabsHTML}
  </div>
  <div id="content"><div class="empty">Loading...</div></div>
</div>

<script>
const PORTAL_CONFIG = ${JSON.stringify(portalConfig)};
${getClientCore()}
${projectSidebarJS}
${tabJS}
${tabLoadersJS}
${urlStateJS}

// --- Init ---
${initJS}

init();
setInterval(loadNextRun, 60000);
setInterval(updateStatusDot, 10000);
setInterval(updateClaudeStatus, 60000);
<\/script>
</body>
</html>`;
}

module.exports = { buildHTML };
