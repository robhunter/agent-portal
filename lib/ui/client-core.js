// client-core.js — Shared client-side JavaScript for the agent portal SPA
// Returns a string of JS to be embedded in the HTML page

/**
 * Get the core client-side JS string.
 * Includes: escapeHtml, formatTimestamp, formatShortDate, formatUptime,
 * tab navigation, status dot, next-run, cron toggle, cycle controls,
 * quick stats, journal tab (load + submit), status tab.
 */
function getClientCore() {
  return `
let currentTab = PORTAL_CONFIG.tabs[0] || 'journal';

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

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
    if (dot) {
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
    }

    // Cycle running indicator
    const cycleEl = document.getElementById('cycle-status');
    const cycleText = document.getElementById('cycle-status-text');
    const cycleBtn = document.getElementById('run-cycle-btn');
    const respondBtn = document.getElementById('run-respond-btn');
    if (cycleEl && cycleBtn && respondBtn) {
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
    }
  } catch {}
}

// --- Claude credentials status ---
async function updateClaudeStatus() {
  const el = document.getElementById('claude-status');
  if (!el) return;
  try {
    const res = await fetch('/api/claude/status');
    const data = await res.json();
    if (data.loggedIn) {
      const sub = data.subscriptionType ? ' (' + escapeHtml(data.subscriptionType) + ')' : '';
      el.innerHTML = '<span class="status-dot status-green" style="width:8px;height:8px;vertical-align:middle;margin-right:4px"></span>Claude: authenticated' + sub;
      el.title = (data.email || '') + ' via ' + (data.authMethod || 'unknown');
      el.style.color = '#2e7d32';
    } else {
      el.innerHTML = '<span class="status-dot status-red" style="width:8px;height:8px;vertical-align:middle;margin-right:4px"></span>Claude: not authenticated';
      el.title = 'Claude credentials missing or expired';
      el.style.color = '#c62828';
    }
  } catch {
    el.textContent = 'Claude: unknown';
    el.style.color = '#888';
  }
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
  const loader = TAB_LOADERS[tab];
  if (loader) loader();
  else document.getElementById('content').innerHTML = '<div class="empty">Unknown tab: ' + escapeHtml(tab) + '</div>';
}

// --- Journal tab ---
async function loadJournal() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading journal...</div>';
  try {
    const res = await fetch('/api/journal');
    const data = await res.json();
    _journalEntries = data.entries || [];
    let html = '<div class="journal-thread">';

    if (_journalEntries.length === 0) {
      html += '<div class="empty" style="margin-top:60px">No journal entries yet. Add the first note below.</div>';
    } else {
      data.entries.forEach(function(e, idx) {
        const dateStr = formatTimestamp(e.ts);
        const editBtn = e.author === 'rob'
          ? '<button class="edit-entry-btn" onclick="startEditEntry(' + idx + ', false)" title="Edit">Edit</button>' : '';
        html += '<div class="journal-entry author-' + escapeHtml(e.author) + '" id="entry-' + idx + '">'
          + '<div class="journal-entry-header">'
          + '<span class="author-badge ' + escapeHtml(e.author) + '">' + escapeHtml(e.author) + '</span>'
          + '<span class="tag-badge tag-' + escapeHtml(e.tag) + '">' + escapeHtml(e.tag) + '</span>'
          + '<span class="timestamp">' + dateStr + '</span>'
          + editBtn
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

var _journalEntries = [];

function startEditEntry(idx, isProjectJournal) {
  var entry = _journalEntries[idx];
  if (!entry) return;
  var el = document.getElementById('entry-' + idx);
  if (!el) return;
  var bodyEl = el.querySelector('.journal-entry-body');
  if (!bodyEl) return;

  var tagOptions = ['note','output','feedback','outcome','observation','direction','question'];
  var tagSelect = '<select id="edit-tag-' + idx + '">'
    + tagOptions.map(function(t) { return '<option value="' + t + '"' + (t === entry.tag ? ' selected' : '') + '>' + t + '</option>'; }).join('')
    + '</select>';

  bodyEl.innerHTML = '<div class="edit-entry-form">'
    + '<textarea id="edit-text-' + idx + '">' + escapeHtml(entry.content) + '</textarea>'
    + '<div class="form-row">'
    + tagSelect
    + '<button onclick="saveEditEntry(' + idx + ', ' + isProjectJournal + ')">Save</button>'
    + '<button class="cancel-btn" onclick="cancelEditEntry(' + idx + ', ' + isProjectJournal + ')">Cancel</button>'
    + '</div>'
    + '</div>';
}

async function saveEditEntry(idx, isProjectJournal) {
  var entry = _journalEntries[idx];
  if (!entry) return;
  var text = document.getElementById('edit-text-' + idx).value.trim();
  var tag = document.getElementById('edit-tag-' + idx).value;
  if (!text) return;

  var url = '/api/journal';
  if (isProjectJournal && typeof currentSlug !== 'undefined' && currentSlug) {
    url = '/api/projects/' + encodeURIComponent(currentSlug) + '/journal';
  }

  try {
    var res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: entry.ts, text: text, tag: tag })
    });
    var data = await res.json();
    if (!data.ok) { alert('Error: ' + (data.error || 'Unknown')); return; }
  } catch { alert('Network error'); return; }

  if (isProjectJournal) {
    if (typeof loadProjectJournal === 'function') await loadProjectJournal();
    else await loadJournal();
  } else {
    await loadJournal();
  }
}

async function cancelEditEntry(idx, isProjectJournal) {
  if (isProjectJournal) {
    if (typeof loadProjectJournal === 'function') await loadProjectJournal();
    else await loadJournal();
  } else {
    await loadJournal();
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

    // Claude credentials
    html += '<div id="claude-status-detail" class="status-card">'
      + '<div class="label">Claude Credentials</div>'
      + '<div class="value">Loading...</div>'
      + '</div>';

    html += '</div>';

    contentEl.innerHTML = html;
    contentEl.querySelectorAll('.md-content a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = 0;

    // Load Claude credentials detail
    try {
      const claudeRes = await fetch('/api/claude/status');
      const claudeData = await claudeRes.json();
      const detailEl = document.getElementById('claude-status-detail');
      if (detailEl) {
        if (claudeData.loggedIn) {
          detailEl.querySelector('.value').innerHTML = '<span style="color:#2e7d32">Authenticated</span>'
            + (claudeData.email ? ' &middot; ' + escapeHtml(claudeData.email) : '')
            + (claudeData.subscriptionType ? ' &middot; ' + escapeHtml(claudeData.subscriptionType) : '')
            + (claudeData.authMethod ? ' &middot; ' + escapeHtml(claudeData.authMethod) : '');
        } else {
          detailEl.querySelector('.value').innerHTML = '<span style="color:#c62828">Not authenticated</span>';
        }
      }
    } catch {}
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load status</div>';
  }
}
`;
}

module.exports = { getClientCore };
