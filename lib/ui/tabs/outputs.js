// outputs.js — Outputs tab client-side JavaScript
// Includes output list, detail view, feedback panel, delete

/**
 * Get the outputs tab client-side JS string.
 */
function getOutputsTabJS() {
  return `
let currentOutputFile = null;
let currentOutputRaw = null;

async function copyRawOutput() {
  if (!currentOutputRaw) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(currentOutputRaw);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = currentOutputRaw;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    const btn = document.getElementById('copy-raw-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy Raw'; }, 2000); }
  } catch { alert('Failed to copy to clipboard'); }
}

async function loadOutputs() {
  const contentEl = document.getElementById('content');
  currentOutputFile = null;
  // Clear file param from URL when returning to list
  var params = new URLSearchParams(window.location.search);
  if (params.has('file')) {
    params.delete('file');
    var qs = params.toString();
    history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
  }
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
  // Update URL to allow deep linking to this output
  var params = new URLSearchParams(window.location.search);
  params.set('tab', 'outputs');
  params.set('file', filename);
  history.replaceState(null, '', '?' + params.toString());
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading output...</div>';
  try {
    const res = await fetch('/api/output/' + encodeURIComponent(filename));
    const data = await res.json();
    if (res.status !== 200) {
      contentEl.innerHTML = '<div class="empty">Output not found</div>';
      return;
    }
    currentOutputRaw = data.content;
    let html = '<div style="max-width:800px">';
    html += '<div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">';
    html += '<a href="#" onclick="loadOutputs();return false" style="color:#1a73e8;text-decoration:none;font-size:13px">&larr; Back to outputs</a>';
    html += '<button class="refresh-btn" onclick="copyRawOutput()" id="copy-raw-btn" style="font-size:12px;padding:4px 10px">Copy Raw</button>';
    html += '</div>';
    html += '<div class="status-card"><div class="md-content">' + marked.parse(data.content) + '</div></div>';

    // Feedback panel
    html += '<div id="feedback-panel" style="margin-top:16px;padding:16px;background:#fff;border-radius:8px;border:1px solid #e8e8e8">';
    html += '<h3 style="font-size:14px;color:#555;margin-bottom:12px">Feedback</h3>';
    html += '<div id="feedback-content">Loading feedback...</div>';
    html += '<textarea id="feedback-notes" rows="3" placeholder="Notes (optional)" style="width:100%;box-sizing:border-box;margin-top:12px;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical"></textarea>';
    html += '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;justify-content:flex-end">';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', 2)">\\u{1F44D}</button>';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', 1)">\\u{1F44E}</button>';
    html += '<button class="refresh-btn" onclick="submitFeedback(\\'' + escapeHtml(filename) + '\\', null)">Submit</button>';
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
  if (!rating && !notes) return;
  const body = {};
  if (rating) body.rating = rating;
  if (notes) body.notes = notes;
  try {
    const res = await fetch('/api/feedback/' + encodeURIComponent(filename), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(function() { return {}; });
      alert('Feedback error: ' + (err.error || res.status));
      return;
    }
    loadFeedback(filename);
    if (notesEl) notesEl.value = '';
    // Refresh project list so unreviewed badges update immediately
    if (typeof loadProjects === 'function') loadProjects();
    alert('Feedback submitted!');
  } catch(e) { alert('Failed to submit feedback: ' + e.message); }
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
