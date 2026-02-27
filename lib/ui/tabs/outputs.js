// outputs.js — Outputs tab client-side JavaScript
// Includes output list, detail view, feedback panel, delete

/**
 * Get the outputs tab client-side JS string.
 */
function getOutputsTabJS() {
  return `
let currentOutputFile = null;

async function loadOutputs() {
  const contentEl = document.getElementById('content');
  currentOutputFile = null;
  const slug = typeof currentSlug !== 'undefined' ? currentSlug : null;
  const url = slug ? '/api/projects/' + encodeURIComponent(slug) + '/outputs' : '/api/outputs';
  contentEl.innerHTML = '<div class="empty">Loading outputs...</div>';
  try {
    const res = await fetch(url);
    const outputs = await res.json();
    if (!outputs || outputs.length === 0) {
      contentEl.innerHTML = '<div class="empty" style="margin-top:60px">No outputs yet.</div>';
      return;
    }
    let html = '<div class="outputs-list" style="max-width:800px">';
    html += '<h2 style="margin-bottom:16px;color:#444">Outputs</h2>';
    outputs.forEach(function(o) {
      const reviewBadge = o.reviewed
        ? '<span class="state-badge state-merged">' + (o.rating === 'up' ? '\\u{1F44D}' : o.rating === 'down' ? '\\u{1F44E}' : 'reviewed') + '</span>'
        : '<span class="unreviewed-badge">unreviewed</span>';
      const dateStr = formatShortDate(o.modified);
      html += '<div class="gh-item" style="cursor:pointer" onclick="viewOutput(\\'' + escapeHtml(o.filename) + '\\')">'
        + '<a style="flex:1">' + escapeHtml(o.filename) + '</a>'
        + reviewBadge
        + '<span class="date">' + dateStr + '</span>'
        + '</div>';
    });
    html += '</div>';
    contentEl.innerHTML = html;
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load outputs</div>';
  }
}

async function viewOutput(filename) {
  currentOutputFile = filename;
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading output...</div>';
  try {
    const res = await fetch('/api/output/' + encodeURIComponent(filename));
    const data = await res.json();
    if (res.status !== 200) {
      contentEl.innerHTML = '<div class="empty">Output not found</div>';
      return;
    }
    let html = '<div style="max-width:800px">';
    html += '<div style="margin-bottom:16px"><a href="#" onclick="loadOutputs();return false" style="color:#1a73e8;text-decoration:none;font-size:13px">&larr; Back to outputs</a></div>';
    html += '<div class="status-card"><div class="md-content">' + marked.parse(data.content) + '</div></div>';

    // Feedback panel
    html += '<div id="feedback-panel" style="margin-top:16px;padding:16px;background:#fff;border-radius:8px;border:1px solid #e8e8e8">';
    html += '<h3 style="font-size:14px;color:#555;margin-bottom:12px">Feedback</h3>';
    html += '<div id="feedback-content">Loading feedback...</div>';
    html += '<div style="margin-top:12px;display:flex;gap:8px;align-items:center">';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', 2)">\\u{1F44D} Thumbs Up</button>';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', 1)">\\u{1F44E} Thumbs Down</button>';
    html += '<input id="feedback-notes" type="text" placeholder="Notes (optional)" style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px">';
    html += '</div>';
    html += '<div style="margin-top:8px"><button class="refresh-btn" style="background:#fce4ec;color:#c62828" onclick="deleteOutput(\\'' + escapeHtml(filename) + '\\')">Delete Output</button></div>';
    html += '</div>';

    html += '</div>';
    contentEl.innerHTML = html;
    contentEl.querySelectorAll('.md-content a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = 0;

    // Load existing feedback
    loadFeedback(filename);
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load output</div>';
  }
}

async function loadFeedback(filename) {
  const el = document.getElementById('feedback-content');
  if (!el) return;
  try {
    const res = await fetch('/api/feedback/' + encodeURIComponent(filename));
    if (res.status === 404) {
      el.innerHTML = '<div style="color:#888;font-size:13px">No feedback yet</div>';
      return;
    }
    const data = await res.json();
    el.innerHTML = '<pre style="font-size:12px;background:#f5f5f5;padding:8px;border-radius:4px;overflow-x:auto">' + escapeHtml(data.content) + '</pre>';
  } catch {
    el.innerHTML = '<div style="color:#888;font-size:13px">Could not load feedback</div>';
  }
}

async function submitFeedback(filename, rating) {
  const notesEl = document.getElementById('feedback-notes');
  const notes = notesEl ? notesEl.value.trim() : '';
  try {
    await fetch('/api/feedback/' + encodeURIComponent(filename), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: rating, notes: notes })
    });
    loadFeedback(filename);
    if (notesEl) notesEl.value = '';
  } catch { alert('Failed to submit feedback'); }
}

async function deleteOutput(filename) {
  if (!confirm('Delete ' + filename + '?')) return;
  try {
    await fetch('/api/output/' + encodeURIComponent(filename), { method: 'DELETE' });
    loadOutputs();
  } catch { alert('Failed to delete output'); }
}
`;
}

module.exports = { getOutputsTabJS };
