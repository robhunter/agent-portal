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
  var html = '<div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:4px;margin-bottom:4px;background:#fafafa;flex-wrap:wrap">';
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
  html += '</div>';
  return html;
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
