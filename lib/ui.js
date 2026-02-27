// ui.js — HTML page generator for the agent portal SPA
// Generates config-driven HTML with embedded CSS and client-side JS
// No external dependencies — uses marked.js from CDN for markdown rendering

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

  // Generate author badge CSS from config
  let authorCSS = '';
  for (const [authorName, style] of Object.entries(authors)) {
    authorCSS += `  .author-badge.${authorName} { background: ${style.bg}; color: ${style.color}; }\n`;
    authorCSS += `  .journal-entry.author-${authorName} { border-left: 3px solid ${style.color}; }\n`;
  }

  // Build tab HTML
  const tabsHTML = tabs.map((t, i) =>
    `<div class="tab${i === 0 ? ' active' : ''}" data-tab="${t}" onclick="switchTab('${t}')">${t.charAt(0).toUpperCase() + t.slice(1)}</div>`
  ).join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — Agent Portal</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #222; display: flex; height: 100vh; }

  /* Sidebar */
  #sidebar { width: 280px; min-width: 280px; background: #fff; border-right: 1px solid #ddd; display: flex; flex-direction: column; }
  #sidebar-header { padding: 16px 16px 8px; display: flex; align-items: center; gap: 8px; }
  #sidebar-header h1 { font-size: 18px; color: #444; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .status-green { background: #4caf50; }
  .status-yellow { background: #ff9800; }
  .status-red { background: #f44336; }
  #next-run { font-size: 12px; color: #888; padding: 0 16px 12px; font-weight: 400; }
  #quick-stats { font-size: 12px; color: #666; padding: 0 16px 12px; border-bottom: 1px solid #eee; }
  #quick-stats span { display: block; margin-bottom: 2px; }

  /* Main panel */
  #main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* Tabs */
  #tabs { display: flex; background: #fff; border-bottom: 1px solid #ddd; padding: 0 24px; }
  .tab { padding: 12px 20px; font-size: 14px; font-weight: 500; color: #666; cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; }
  .tab:hover { color: #333; }
  .tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }

  /* Content area */
  #content { flex: 1; overflow-y: auto; padding: 24px 32px; }
  #content .empty { color: #999; text-align: center; margin-top: 30vh; font-size: 16px; }

  /* Journal thread */
  .journal-thread { max-width: 800px; }
  .journal-entry { margin-bottom: 16px; padding: 12px 16px; background: #fff; border-radius: 8px; border: 1px solid #e8e8e8; }
  .journal-entry-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; flex-wrap: wrap; }
  .journal-entry-header .timestamp { color: #888; }
  .author-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; }
  .tag-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
  .tag-output { background: #e8f5e9; color: #2e7d32; }
  .tag-feedback { background: #fff3e0; color: #e65100; }
  .tag-outcome { background: #e3f2fd; color: #1565c0; }
  .tag-observation { background: #f3e5f5; color: #7b1fa2; }
  .tag-note { background: #f5f5f5; color: #616161; }
  .tag-direction { background: #fce4ec; color: #c62828; }
  .tag-question { background: #fff8e1; color: #f57f17; }
  .journal-entry-body { font-size: 14px; line-height: 1.6; }
  .journal-entry-body p { margin-bottom: 8px; }
  .journal-entry-body a { color: #1a73e8; }

  /* Author-specific badge styles from config */
${authorCSS}
  /* Add note form */
  #add-note { max-width: 800px; margin-top: 16px; padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #ddd; }
  #add-note h3 { font-size: 14px; color: #555; margin-bottom: 10px; }
  #add-note-form { display: flex; flex-direction: column; gap: 10px; }
  #add-note-form .form-row { display: flex; gap: 10px; align-items: flex-start; }
  #note-text { flex: 1; min-height: 60px; border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-family: inherit; font-size: 14px; resize: vertical; }
  #note-tag { border: 1px solid #ddd; border-radius: 6px; padding: 8px; font-family: inherit; font-size: 14px; background: #fff; }
  #note-submit { padding: 8px 20px; background: #1a73e8; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; align-self: flex-end; }
  #note-submit:hover { background: #1557b0; }
  #note-submit:disabled { background: #aaa; cursor: not-allowed; }

  /* GitHub tab */
  .gh-section { max-width: 800px; margin-bottom: 32px; }
  .gh-section h2 { font-size: 16px; color: #444; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
  .gh-item { padding: 10px 16px; background: #fff; border-radius: 8px; border: 1px solid #e8e8e8; margin-bottom: 6px; display: flex; align-items: center; gap: 10px; }
  .gh-item a { color: #1a73e8; text-decoration: none; font-weight: 500; font-size: 14px; }
  .gh-item a:hover { text-decoration: underline; }
  .gh-item .number { color: #888; font-size: 13px; min-width: 36px; }
  .gh-item .date { color: #aaa; font-size: 12px; margin-left: auto; white-space: nowrap; }
  .gh-label { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; margin-left: 6px; }
  .state-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
  .state-open { background: #e8f5e9; color: #2e7d32; }
  .state-merged { background: #ede7f6; color: #4527a0; }
  .state-closed { background: #fce4ec; color: #c62828; }
  .refresh-btn { padding: 4px 14px; background: #fff; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; cursor: pointer; color: #555; }
  .refresh-btn:hover { background: #f5f5f5; }

  /* Status tab */
  .status-section { max-width: 800px; margin-bottom: 28px; }
  .status-section h2 { font-size: 16px; color: #444; margin-bottom: 12px; }
  .status-card { padding: 14px 18px; background: #fff; border-radius: 8px; border: 1px solid #e8e8e8; margin-bottom: 8px; }
  .status-card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .status-card .value { font-size: 14px; color: #333; }
  .event-item { padding: 8px 14px; background: #fff; border-radius: 6px; border: 1px solid #e8e8e8; margin-bottom: 4px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .event-item .event-ts { color: #888; font-size: 12px; min-width: 100px; }
  .event-type-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; }
  .event-type-cycle_start { background: #e8f5e9; color: #2e7d32; }
  .event-type-cycle_end { background: #e3f2fd; color: #1565c0; }
  .event-type-research { background: #fff3e0; color: #e65100; }
  .event-type-error { background: #fce4ec; color: #c62828; }
  .event-type-reflect { background: #f3e5f5; color: #7b1fa2; }
  .event-type-notify { background: #fff8e1; color: #f57f17; }
  .event-type-default { background: #f5f5f5; color: #616161; }
  .win-item { padding: 10px 14px; background: #fff; border-radius: 6px; border: 1px solid #e8e8e8; margin-bottom: 4px; }
  .win-item .win-desc { font-size: 14px; }
  .win-item .win-meta { font-size: 12px; color: #888; margin-top: 4px; }

  /* Markdown styling */
  .md-content h1 { font-size: 24px; margin-bottom: 8px; }
  .md-content h2 { font-size: 20px; margin-top: 24px; margin-bottom: 8px; }
  .md-content h3 { font-size: 16px; margin-top: 20px; margin-bottom: 6px; }
  .md-content p { margin-bottom: 12px; line-height: 1.6; }
  .md-content ul, .md-content ol { margin-bottom: 12px; padding-left: 24px; }
  .md-content li { margin-bottom: 4px; line-height: 1.5; }
  .md-content blockquote { border-left: 4px solid #1a73e8; padding: 12px 16px; margin-bottom: 16px; background: #f0f7ff; color: #333; }
  .md-content a { color: #1a73e8; }
  .md-content code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  .md-content pre { background: #f0f0f0; padding: 12px; border-radius: 6px; overflow-x: auto; margin-bottom: 12px; }
  .md-content pre code { background: none; padding: 0; }
  .md-content table { border-collapse: collapse; margin-bottom: 12px; }
  .md-content th, .md-content td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  .md-content th { background: #f5f5f5; }
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
let currentTab = PORTAL_CONFIG.tabs[0] || 'journal';

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTimestamp(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

function formatShortDate(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString();
}

function formatUptime(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h + 'h ' + m + 'm';
}

// --- Status dot ---
async function updateStatusDot() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const dot = document.getElementById('status-dot');
    if (data.lastWake && data.lastWake.ts) {
      const hoursAgo = (Date.now() - new Date(data.lastWake.ts).getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 8) {
        dot.className = 'status-dot status-green';
      } else if (hoursAgo < 24) {
        dot.className = 'status-dot status-yellow';
      } else {
        dot.className = 'status-dot status-red';
      }
      dot.title = 'Last cycle: ' + formatTimestamp(data.lastWake.ts);
    } else {
      dot.className = 'status-dot status-red';
      dot.title = 'No cycle data';
    }

    // Cycle running indicator
    const cycleEl = document.getElementById('cycle-status');
    const cycleText = document.getElementById('cycle-status-text');
    const cycleBtn = document.getElementById('run-cycle-btn');
    const respondBtn = document.getElementById('run-respond-btn');
    if (data.cycleRunning) {
      cycleEl.style.display = 'block';
      cycleText.innerHTML = '<span class="status-dot status-green" style="width:8px;height:8px;vertical-align:middle;margin-right:4px"></span>Agent running';
      cycleText.style.color = '#2e7d32';
      cycleBtn.disabled = true;
      respondBtn.disabled = true;
      cycleBtn.style.opacity = '0.5';
      respondBtn.style.opacity = '0.5';
    } else {
      cycleEl.style.display = 'none';
      cycleBtn.disabled = false;
      respondBtn.disabled = false;
      cycleBtn.style.opacity = '1';
      respondBtn.style.opacity = '1';
    }
  } catch {}
}

// --- Next run ---
async function loadNextRun() {
  try {
    const res = await fetch('/api/next-run');
    const data = await res.json();
    const el = document.getElementById('next-run');

    if (!data.installed) {
      el.textContent = 'Cron not installed';
      el.style.color = '#c62828';
    } else if (data.daemonRunning === false) {
      el.textContent = 'Cron daemon not running';
      el.style.color = '#c62828';
    } else if (data.enabled === false) {
      el.textContent = 'Cron disabled';
      el.style.color = '#c62828';
    } else if (data.error) {
      el.textContent = data.error;
      el.style.color = '#c62828';
    } else {
      const next = new Date(data.next);
      const now = new Date();
      const diffMs = next - now;
      const diffMins = Math.max(0, Math.round(diffMs / 60000));
      let label;
      if (diffMins < 60) {
        label = diffMins + 'm';
      } else {
        const h = Math.floor(diffMins / 60);
        const m = diffMins % 60;
        label = h + 'h ' + m + 'm';
      }
      const timeStr = next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.textContent = 'Next run: ' + timeStr + ' (' + label + ')';
      el.style.color = '#888';
    }
    el.title = 'Cron: ' + (data.cron || 'none');

    // Update toggle button
    const toggleWrap = document.getElementById('cron-toggle-wrap');
    const toggleBtn = document.getElementById('cron-toggle-btn');
    if (data.installed && data.daemonRunning !== false) {
      toggleWrap.style.display = 'block';
      if (data.enabled === false) {
        toggleBtn.textContent = 'Enable Cron';
        toggleBtn.style.background = '#e8f5e9';
        toggleBtn.style.color = '#2e7d32';
      } else {
        toggleBtn.textContent = 'Disable Cron';
        toggleBtn.style.background = '#fff';
        toggleBtn.style.color = '#555';
      }
    } else {
      toggleWrap.style.display = 'none';
    }
  } catch {}
}

async function toggleCron() {
  const btn = document.getElementById('cron-toggle-btn');
  btn.disabled = true;
  btn.textContent = 'Toggling...';
  try {
    await fetch('/api/cron/toggle', { method: 'POST' });
  } catch {}
  btn.disabled = false;
  await loadNextRun();
}

async function runCycle() {
  const btn = document.getElementById('run-cycle-btn');
  btn.disabled = true;
  btn.textContent = 'Starting...';
  try {
    const res = await fetch('/api/cycle/run', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) alert(data.error || 'Failed to start cycle');
  } catch { alert('Request failed'); }
  btn.disabled = false;
  btn.textContent = 'Run Cycle';
  updateStatusDot();
}

async function runRespond() {
  const btn = document.getElementById('run-respond-btn');
  btn.disabled = true;
  btn.textContent = 'Starting...';
  try {
    const res = await fetch('/api/cycle/respond', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) alert(data.error || 'Failed to start respond cycle');
  } catch { alert('Request failed'); }
  btn.disabled = false;
  btn.textContent = 'Respond';
  updateStatusDot();
}

// --- Quick stats ---
async function loadQuickStats() {
  if (!PORTAL_CONFIG.hasGitHub) return;
  try {
    const [issuesRes, prsRes] = await Promise.all([
      fetch('/api/github/issues'),
      fetch('/api/github/prs'),
    ]);
    const issuesData = await issuesRes.json();
    const prsData = await prsRes.json();
    const issueCount = Array.isArray(issuesData.items) ? issuesData.items.length : 0;
    const openPrCount = Array.isArray(prsData.items) ? prsData.items.filter(function(p) { return p.state === 'OPEN'; }).length : 0;
    const issuesEl = document.getElementById('stat-issues');
    const prsEl = document.getElementById('stat-prs');
    issuesEl.textContent = issueCount + ' issues open';
    issuesEl.style.display = 'block';
    prsEl.textContent = openPrCount + ' PRs open';
    prsEl.style.display = 'block';
  } catch {}
}

// --- Tabs ---
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  if (tab === 'journal') loadJournal();
  else if (tab === 'github') loadGitHub();
  else if (tab === 'status') loadStatus();
}

// --- Journal tab ---
async function loadJournal() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading journal...</div>';
  try {
    const res = await fetch('/api/journal');
    const data = await res.json();
    let html = '<div class="journal-thread">';

    if (!data.entries || data.entries.length === 0) {
      html += '<div class="empty" style="margin-top:60px">No journal entries yet. Add the first note below.</div>';
    } else {
      data.entries.forEach(function(e) {
        const dateStr = formatTimestamp(e.ts);
        html += '<div class="journal-entry author-' + escapeHtml(e.author) + '">'
          + '<div class="journal-entry-header">'
          + '<span class="author-badge ' + escapeHtml(e.author) + '">' + escapeHtml(e.author) + '</span>'
          + '<span class="tag-badge tag-' + escapeHtml(e.tag) + '">' + escapeHtml(e.tag) + '</span>'
          + '<span class="timestamp">' + dateStr + '</span>'
          + '</div>'
          + '<div class="journal-entry-body md-content">' + marked.parse(e.content) + '</div>'
          + '</div>';
      });
    }

    html += '</div>';

    // Add note form
    html += '<div id="add-note">'
      + '<h3>Add a note</h3>'
      + '<div id="add-note-form">'
      + '<textarea id="note-text" placeholder="Share an update, observation, or note..."></textarea>'
      + '<div class="form-row">'
      + '<select id="note-tag">'
      + '<option value="note" selected>note</option>'
      + '<option value="output">output</option>'
      + '<option value="feedback">feedback</option>'
      + '<option value="outcome">outcome</option>'
      + '<option value="observation">observation</option>'
      + '<option value="direction">direction</option>'
      + '<option value="question">question</option>'
      + '</select>'
      + '<button id="note-submit" onclick="submitNote()">Add</button>'
      + '</div>'
      + '</div>'
      + '</div>';

    contentEl.innerHTML = html;
    contentEl.querySelectorAll('.journal-entry-body a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = contentEl.scrollHeight;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load journal</div>';
  }
}

async function submitNote() {
  const text = document.getElementById('note-text').value.trim();
  const tag = document.getElementById('note-tag').value;
  if (!text) return;
  const btn = document.getElementById('note-submit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await fetch('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, tag: tag })
    });
  } catch {}
  await loadJournal();
}

// --- GitHub tab ---
async function loadGitHub() {
  const contentEl = document.getElementById('content');
  if (!PORTAL_CONFIG.hasGitHub) {
    contentEl.innerHTML = '<div class="empty">GitHub integration not configured</div>';
    return;
  }
  contentEl.innerHTML = '<div class="empty">Loading GitHub data...</div>';

  try {
    const [issuesRes, prsRes] = await Promise.all([
      fetch('/api/github/issues'),
      fetch('/api/github/prs'),
    ]);
    const issuesData = await issuesRes.json();
    const prsData = await prsRes.json();

    let html = '';

    // Refresh button
    html += '<div style="max-width:800px;margin-bottom:16px;text-align:right">'
      + '<button class="refresh-btn" onclick="loadGitHub()">Refresh</button>'
      + '</div>';

    // Issues
    html += '<div class="gh-section"><h2>Open Issues</h2>';
    const issues = Array.isArray(issuesData.items) ? issuesData.items : [];
    if (issues.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:12px 0">No open issues' + (issuesData.error ? ' (error: ' + escapeHtml(issuesData.error) + ')' : '') + '</div>';
    } else {
      const multiRepo = issuesData.repos && issuesData.repos.length > 1;
      issues.forEach(function(issue) {
        const labels = (issue.labels || []).map(function(l) {
          const lname = typeof l === 'string' ? l : (l.name || '');
          const color = (typeof l === 'object' && l.color) ? l.color : '666';
          return '<span class="gh-label" style="background:#' + escapeHtml(color) + '22;color:#' + escapeHtml(color) + '">' + escapeHtml(lname) + '</span>';
        }).join('');
        const url = issue.url || '#';
        const repoLabel = multiRepo && issue.repo ? '<span class="gh-label" style="background:#e3f2fd;color:#1565c0">' + escapeHtml(issue.repo.split('/').pop()) + '</span>' : '';
        html += '<div class="gh-item">'
          + '<span class="number">#' + issue.number + '</span>'
          + '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + escapeHtml(issue.title) + '</a>'
          + repoLabel
          + labels
          + '<span class="date">' + formatShortDate(issue.createdAt) + '</span>'
          + '</div>';
      });
    }
    html += '</div>';

    // PRs
    html += '<div class="gh-section"><h2>Recent PRs</h2>';
    const prs = Array.isArray(prsData.items) ? prsData.items : [];
    if (prs.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:12px 0">No PRs' + (prsData.error ? ' (error: ' + escapeHtml(prsData.error) + ')' : '') + '</div>';
    } else {
      const multiRepoPr = prsData.repos && prsData.repos.length > 1;
      prs.forEach(function(pr) {
        let stateClass = 'state-open';
        let stateLabel = 'open';
        if (pr.state === 'MERGED' || pr.mergedAt) { stateClass = 'state-merged'; stateLabel = 'merged'; }
        else if (pr.state === 'CLOSED') { stateClass = 'state-closed'; stateLabel = 'closed'; }
        const prUrl = pr.url || '#';
        const dateStr = pr.mergedAt ? formatShortDate(pr.mergedAt) : formatShortDate(pr.createdAt);
        const prRepoLabel = multiRepoPr && pr.repo ? '<span class="gh-label" style="background:#e3f2fd;color:#1565c0">' + escapeHtml(pr.repo.split('/').pop()) + '</span>' : '';
        html += '<div class="gh-item">'
          + '<span class="number">#' + pr.number + '</span>'
          + '<a href="' + escapeHtml(prUrl) + '" target="_blank" rel="noopener">' + escapeHtml(pr.title) + '</a>'
          + prRepoLabel
          + '<span class="state-badge ' + stateClass + '">' + stateLabel + '</span>'
          + '<span class="date">' + dateStr + '</span>'
          + '</div>';
      });
    }
    html += '</div>';

    contentEl.innerHTML = html;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load GitHub data</div>';
  }
}

// --- Status tab ---
async function loadStatus() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading status...</div>';

  try {
    const [statusRes, eventsRes, winsRes, todayRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/events'),
      fetch('/api/wins'),
      fetch('/api/today'),
    ]);
    const status = await statusRes.json();
    const events = await eventsRes.json();
    const wins = await winsRes.json();
    const today = await todayRes.json();

    let html = '';

    // Today.md
    html += '<div class="status-section">'
      + '<h2>Today</h2>'
      + '<div class="status-card"><div class="md-content">' + marked.parse(today.content || '*No today.md*') + '</div></div>'
      + '</div>';

    // Recent events (last 20)
    html += '<div class="status-section"><h2>Recent Events</h2>';
    const recentEvents = Array.isArray(events) ? events.slice(-20).reverse() : [];
    if (recentEvents.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No events recorded yet</div>';
    } else {
      recentEvents.forEach(function(evt) {
        const typeClass = 'event-type-' + (evt.type || 'default');
        html += '<div class="event-item">'
          + '<span class="event-ts">' + formatTimestamp(evt.ts || '') + '</span>'
          + '<span class="event-type-badge ' + typeClass + '">' + escapeHtml(evt.type || 'event') + '</span>'
          + '<span>' + escapeHtml(evt.summary || evt.description || '') + '</span>'
          + '</div>';
      });
    }
    html += '</div>';

    // Recent wins
    html += '<div class="status-section"><h2>Recent Wins</h2>';
    if (!Array.isArray(wins) || wins.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No wins in the last 30 days</div>';
    } else {
      wins.slice().reverse().forEach(function(w) {
        html += '<div class="win-item">'
          + '<div class="win-desc">' + escapeHtml(w.description || '') + '</div>'
          + '<div class="win-meta">' + formatTimestamp(w.ts || '') + (w.project ? ' &middot; ' + escapeHtml(w.project) : '') + '</div>'
          + '</div>';
      });
    }
    html += '</div>';

    // System info
    html += '<div class="status-section"><h2>System</h2>';

    // Services
    if (status.services) {
      Object.keys(status.services).forEach(function(svcName) {
        const svc = status.services[svcName];
        let detail = '';
        if (svcName === 'portal-server') {
          detail = 'PID ' + (svc.pid || '?') + ' &middot; uptime ' + formatUptime(svc.uptime || 0);
        } else if (svcName === 'cron') {
          detail = !svc.installed ? 'Not installed' : svc.daemonRunning ? 'Running' : 'Installed but daemon not running';
        } else {
          detail = svc.alive ? 'Running (PID ' + svc.pid + ')' : 'Stopped';
        }
        html += '<div class="status-card">'
          + '<div class="label">' + escapeHtml(svcName) + '</div>'
          + '<div class="value">' + detail + '</div>'
          + '</div>';
      });
    }

    // Git
    if (status.git) {
      html += '<div class="status-card">'
        + '<div class="label">Git</div>'
        + '<div class="value">' + escapeHtml(status.git.branch || '?') + ' @ ' + escapeHtml(status.git.head || '?') + '</div>'
        + '</div>';
    }

    // Server time
    html += '<div class="status-card">'
      + '<div class="label">Server Time</div>'
      + '<div class="value">' + formatTimestamp(status.serverTime || '') + '</div>'
      + '</div>';

    html += '</div>';

    contentEl.innerHTML = html;
    contentEl.querySelectorAll('.md-content a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = 0;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load status</div>';
  }
}

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
