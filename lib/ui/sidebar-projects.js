// sidebar-projects.js — Project-centric sidebar variant client JS
// Used when config.sidebar.type === 'projects'

/**
 * Get the project sidebar client-side JS string.
 * Handles project list rendering, selection, running log, and per-project navigation.
 */
function getProjectSidebarJS() {
  return `
let projects = [];
let currentSlug = null;

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    projects = await res.json();
    renderSidebar();
  } catch {}
}

function renderSidebar() {
  const list = document.getElementById('project-list');
  list.innerHTML = projects.map(function(p) {
    const cls = 'project-item' + (p.slug === currentSlug ? ' active' : '');
    const badge = '<span class="priority-badge priority-' + p.priority + '">' + p.priority + '</span>';
    const unreviewedBadge = p.unreviewedCount > 0
      ? ' <span class="unreviewed-badge">' + p.unreviewedCount + ' to review</span>' : '';
    const metaParts = [];
    if (p.outputCount > 0) {
      metaParts.push(p.outputCount + ' output' + (p.outputCount !== 1 ? 's' : ''));
    }
    if (p.entryCount > 0) {
      metaParts.push(p.entryCount + ' journal');
    }
    if (p.lastActivity) {
      metaParts.push(new Date(p.lastActivity).toLocaleDateString());
    }
    const meta = metaParts.join(' \\u00b7 ');
    return '<div class="' + cls + '" onclick="selectProject(\\'' + p.slug + '\\')">'
      + '<div class="title">' + escapeHtml(p.title) + ' ' + badge + unreviewedBadge + '</div>'
      + '<div class="meta">' + meta + '</div>'
      + '</div>';
  }).join('');
}

async function selectProject(slug) {
  currentSlug = slug;
  const logItem = document.getElementById('bobbo-log-item');
  if (logItem) logItem.classList.remove('active');
  renderSidebar();
  document.getElementById('tabs').classList.remove('tabs-hidden');
  closeSidebar();
  switchTab('journal');
}

async function selectBobboLog() {
  currentSlug = null;
  renderSidebar();
  const logItem = document.getElementById('bobbo-log-item');
  if (logItem) logItem.classList.add('active');
  document.getElementById('tabs').classList.add('tabs-hidden');
  closeSidebar();
  // Load cross-project running log (the monthly journal files)
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading running log...</div>';
  try {
    const res = await fetch('/api/journal');
    const data = await res.json();
    let html = '<div class="journal-thread"><h2 style="margin-bottom:16px;color:#444">Running Log</h2>';
    _journalEntries = data.entries || [];
    if (_journalEntries.length === 0) {
      html += '<div class="empty" style="margin-top:40px">No entries yet.</div>';
    } else {
      _journalEntries.forEach(function(e, idx) {
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

    // Add note form for running log
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
      + '<button id="note-submit" onclick="submitLogNote()">Add</button>'
      + '</div>'
      + '</div>'
      + '</div>';

    contentEl.innerHTML = html;
    fixOutputLinks(contentEl);
    contentEl.scrollTop = contentEl.scrollHeight;
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load running log</div>';
  }
}

async function submitLogNote() {
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
  await selectBobboLog();
}

// Override loadJournal to load per-project journal when a project is selected
const _originalLoadJournal = typeof loadJournal === 'function' ? loadJournal : null;

async function loadProjectJournal() {
  if (!currentSlug) {
    if (_originalLoadJournal) return _originalLoadJournal();
    return;
  }
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading journal...</div>';
  try {
    const res = await fetch('/api/projects/' + encodeURIComponent(currentSlug) + '/journal');
    const data = await res.json();
    _journalEntries = data.entries || [];
    let html = '<div class="journal-thread">';
    if (_journalEntries.length === 0) {
      html += '<div class="empty" style="margin-top:60px">No journal entries yet.</div>';
    } else {
      _journalEntries.forEach(function(e, idx) {
        const dateStr = formatTimestamp(e.ts);
        const editBtn = e.author === 'rob'
          ? '<button class="edit-entry-btn" onclick="startEditEntry(' + idx + ', true)" title="Edit">Edit</button>' : '';
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

    // Add note form for project journal
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
      + '<button id="note-submit" onclick="submitProjectNote()">Add</button>'
      + '</div>'
      + '</div>'
      + '</div>';

    contentEl.innerHTML = html;
    fixOutputLinks(contentEl);
    contentEl.scrollTop = contentEl.scrollHeight;
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load journal</div>';
  }
}

async function submitProjectNote() {
  const text = document.getElementById('note-text').value.trim();
  const tag = document.getElementById('note-tag').value;
  if (!text || !currentSlug) return;
  const btn = document.getElementById('note-submit');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await fetch('/api/projects/' + encodeURIComponent(currentSlug) + '/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, tag: tag })
    });
  } catch {}
  await loadProjectJournal();
}

async function loadProjectFile() {
  if (!currentSlug) return;
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading project...</div>';
  try {
    const res = await fetch('/api/projects/' + encodeURIComponent(currentSlug) + '/file');
    const data = await res.json();
    contentEl.innerHTML = '<div class="status-section"><div class="status-card"><div class="md-content">'
      + marked.parse(data.content || '*No project file found.*')
      + '</div></div></div>';
    contentEl.querySelectorAll('.md-content a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = 0;
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load project file</div>';
  }
}
`;
}

module.exports = { getProjectSidebarJS };
