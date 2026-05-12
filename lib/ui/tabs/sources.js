// sources.js — Sources tab client-side JavaScript
// Source management: list, approve/deny pending, credentials

function getSourcesTabJS() {
  return `
async function loadSources() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading sources...</div>';
  try {
    var res = await fetch('/api/sources');
    var sources = await res.json();
    window.__sourcesCache = sources; // used by editSourceNotes to seed the textarea

    var pending = sources.filter(function(s) { return s.status === 'pending'; });
    var approved = sources.filter(function(s) { return s.status === 'approved'; });
    var denied = sources.filter(function(s) { return s.status === 'denied'; });

    var html = '<div class="status-section">';
    html += '<h2 style="margin:0 0 16px;font-size:18px">Content Sources</h2>';

    // Pending sources (highlighted)
    if (pending.length > 0) {
      html += '<div style="margin-bottom:24px">';
      html += '<h3 style="margin:0 0 8px;font-size:15px;color:#e65100">⚠ Pending Approval (' + pending.length + ')</h3>';
      pending.forEach(function(s) {
        html += '<div class="pending-source">';
        html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
        html += '<strong style="font-size:14px">' + escapeHtml(s.name) + '</strong>';
        html += '<span style="font-size:12px;color:#888">' + escapeHtml(s.url) + '</span>';
        html += '<span class="category-badge" style="background:#f5f5f5;color:#666">' + escapeHtml(s.type) + '</span>';
        if (s.categories && s.categories.length) {
          s.categories.forEach(function(c) {
            html += '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#e8f5e9;color:#2e7d32">' + escapeHtml(c) + '</span>';
          });
        }
        html += '</div>';
        html += '<div style="display:flex;gap:6px;margin-top:8px">';
        html += '<button class="refresh-btn" style="background:#e8f5e9;color:#2e7d32" onclick="approveSource(\\'' + escapeHtml(s.id) + '\\')">✓ Approve</button>';
        html += '<button class="refresh-btn" style="background:#ffebee;color:#c62828" onclick="denySource(\\'' + escapeHtml(s.id) + '\\')">✗ Deny</button>';
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Approved sources
    if (approved.length > 0) {
      html += '<h3 style="margin:0 0 8px;font-size:15px;color:#2e7d32">✓ Approved (' + approved.length + ')</h3>';
      approved.forEach(function(s) {
        html += renderSourceRow(s);
      });
    }

    // Denied sources
    if (denied.length > 0) {
      html += '<h3 style="margin:16px 0 8px;font-size:15px;color:#c62828">✗ Denied (' + denied.length + ')</h3>';
      denied.forEach(function(s) {
        html += renderSourceRow(s);
      });
    }

    if (sources.length === 0) {
      html += '<div class="empty">No sources configured</div>';
    }

    html += '</div>';
    contentEl.innerHTML = html;
    contentEl.scrollTop = 0;
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load sources</div>';
  }
}

function renderSourceRow(s) {
  var statusColor = s.status === 'approved' ? '#2e7d32' : s.status === 'denied' ? '#c62828' : '#e65100';
  var html = '<div class="source-card" data-source-id="' + escapeHtml(s.id) + '" style="padding:8px;border-radius:4px;margin-bottom:6px;background:#fafafa">';

  // Top row — metadata + action buttons
  html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
  html += '<strong style="font-size:13px;min-width:120px">' + escapeHtml(s.name) + '</strong>';
  html += '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" style="font-size:12px;color:#1565c0">' + escapeHtml(s.url) + '</a>';
  html += '<span class="category-badge" style="background:#f5f5f5;color:#666">' + escapeHtml(s.type) + '</span>';
  html += '<span style="font-size:11px;color:' + statusColor + '">' + escapeHtml(s.status) + '</span>';
  if (s.categories && s.categories.length) {
    s.categories.forEach(function(c) {
      html += '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#e8f5e9;color:#2e7d32">' + escapeHtml(c) + '</span>';
    });
  }
  if (s.hasCredentials) {
    html += '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#e8eaf6;color:#283593">🔑 Credentials</span>';
  }
  if (s.thumbnail_strategy) {
    html += '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#fce4ec;color:#880e4f" title="' + escapeHtml(s.thumbnail_strategy.trim()) + '">🖼 Thumbnail</span>';
  }
  html += '<div style="margin-left:auto;display:flex;gap:4px">';
  if (s.status !== 'approved') {
    html += '<button class="refresh-btn" style="padding:2px 8px;font-size:11px;background:#e8f5e9;color:#2e7d32" onclick="approveSource(\\'' + escapeHtml(s.id) + '\\')">✓ Approve</button>';
  }
  if (s.status !== 'denied') {
    html += '<button class="refresh-btn" style="padding:2px 8px;font-size:11px;background:#ffebee;color:#c62828" onclick="denySource(\\'' + escapeHtml(s.id) + '\\')">✗ Deny</button>';
  }
  html += '</div>';
  html += '</div>';

  // Notes block (only shown for approved sources — operator guidance)
  if (s.status === 'approved') {
    html += renderNotesBlock(s);
  }

  html += '</div>';
  return html;
}

function renderNotesBlock(s) {
  var safeId = escapeHtml(s.id);
  var hasNotes = s.notes && s.notes.trim().length > 0;
  var html = '<div class="source-notes" id="notes-' + safeId + '" style="margin-top:6px;font-size:12px;color:#555">';
  if (hasNotes) {
    html += '<div class="notes-view" style="display:flex;align-items:flex-start;gap:8px">';
    html += '<span style="color:#888;font-weight:600;min-width:48px">Notes:</span>';
    html += '<pre style="margin:0;flex:1;white-space:pre-wrap;font-family:inherit">' + escapeHtml(s.notes.trim()) + '</pre>';
    html += '<button class="refresh-btn" style="padding:1px 6px;font-size:10px" onclick="editSourceNotes(\\'' + safeId + '\\')">Edit</button>';
    html += '</div>';
  } else {
    html += '<div class="notes-view">';
    html += '<button class="refresh-btn" style="padding:1px 6px;font-size:10px;color:#888" onclick="editSourceNotes(\\'' + safeId + '\\')">+ Add notes</button>';
    html += '</div>';
  }
  // Hidden edit form (revealed by editSourceNotes)
  html += '<div class="notes-edit" style="display:none;flex-direction:column;gap:4px">';
  html += '<textarea id="notes-textarea-' + safeId + '" style="width:100%;min-height:60px;font-family:inherit;font-size:12px;padding:6px;box-sizing:border-box" placeholder="Operator guidance for this source (e.g., \\'only recommend from the $4.99 shelf\\')"></textarea>';
  html += '<div style="display:flex;gap:6px;justify-content:flex-end">';
  html += '<button class="refresh-btn" style="padding:2px 8px;font-size:11px" onclick="cancelSourceNotes(\\'' + safeId + '\\')">Cancel</button>';
  html += '<button class="refresh-btn" style="padding:2px 8px;font-size:11px;background:#e3f2fd;color:#1565c0" onclick="saveSourceNotes(\\'' + safeId + '\\')">Save</button>';
  html += '</div>';
  html += '</div>';
  html += '</div>';
  return html;
}

function getSourceById(id) {
  // Pulled from the in-memory list cached on window during loadSources
  return (window.__sourcesCache || []).find(function(s) { return s.id === id; });
}

function editSourceNotes(id) {
  var container = document.getElementById('notes-' + id);
  if (!container) return;
  var view = container.querySelector('.notes-view');
  var edit = container.querySelector('.notes-edit');
  var textarea = document.getElementById('notes-textarea-' + id);
  var s = getSourceById(id);
  textarea.value = (s && s.notes) ? s.notes.trim() : '';
  view.style.display = 'none';
  edit.style.display = 'flex';
  textarea.focus();
}

function cancelSourceNotes(id) {
  var container = document.getElementById('notes-' + id);
  if (!container) return;
  container.querySelector('.notes-view').style.display = '';
  container.querySelector('.notes-edit').style.display = 'none';
}

async function saveSourceNotes(id) {
  var textarea = document.getElementById('notes-textarea-' + id);
  if (!textarea) return;
  var notes = textarea.value;
  try {
    var res = await fetch('/api/sources/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes })
    });
    if (!res.ok) {
      alert('Failed to save notes: HTTP ' + res.status);
      return;
    }
    loadSources();
  } catch (err) {
    alert('Failed to save notes: ' + (err && err.message ? err.message : 'network error'));
  }
}

async function approveSource(id) {
  try {
    await fetch('/api/sources/' + encodeURIComponent(id) + '/approve', { method: 'POST' });
    loadSources();
  } catch {}
}

async function denySource(id) {
  try {
    await fetch('/api/sources/' + encodeURIComponent(id) + '/deny', { method: 'POST' });
    loadSources();
  } catch {}
}
`;
}

module.exports = { getSourcesTabJS };
