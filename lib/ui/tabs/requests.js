// tabs/requests.js — Requests tab client-side JS
// Renders PM request list with status badges, markdown content, and reply forms

function getRequestsTabJS() {
  return `
// --- Requests tab ---
var _requestFiles = [];

async function loadRequests() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading requests...</div>';
  try {
    var res = await fetch('/api/requests');
    var data = await res.json();
    var items = data.items || [];
    _requestFiles = items.map(function(r) { return r.file; });
    var html = '<div class="status-section"><h2>PM Requests</h2>';
    if (items.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No requests filed yet.</div>';
    } else {
      items.forEach(function(req, idx) {
        var statusClass = 'tag-note';
        if (req.status === 'pending') statusClass = 'tag-question';
        else if (req.status === 'approved') statusClass = 'tag-output';
        else if (req.status === 'rejected') statusClass = 'tag-feedback';
        else if (req.status === 'completed') statusClass = 'tag-outcome';
        html += '<div class="journal-entry" style="border-left:3px solid #ff9800">'
          + '<div class="journal-entry-header">'
          + '<span style="font-weight:600;font-size:14px">' + escapeHtml(req.title) + '</span>'
          + '<span class="tag-badge ' + statusClass + '">' + escapeHtml(req.status) + '</span>'
          + (req.filed ? '<span class="timestamp">Filed ' + escapeHtml(req.filed) + '</span>' : '')
          + '</div>'
          + '<div class="journal-entry-body md-content">' + marked.parse(req.content) + '</div>';

        // Reply form
        html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #eee">'
          + '<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">'
          + '<textarea id="reply-comment-' + idx + '" placeholder="Reply..." style="flex:1;min-width:200px;min-height:48px;border:1px solid #ddd;border-radius:6px;padding:6px 8px;font-size:13px;font-family:inherit;resize:vertical"></textarea>'
          + '<button onclick="replyToRequest(' + idx + ')" style="padding:6px 16px;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;white-space:nowrap">Reply</button>'
          + '</div>'
          + '</div>';

        html += '</div>';
      });
    }
    html += '</div>';
    contentEl.innerHTML = html;
    contentEl.querySelectorAll('.md-content a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = 0;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load requests</div>';
  }
}

async function replyToRequest(idx) {
  var file = _requestFiles[idx];
  if (!file) return;
  var commentEl = document.getElementById('reply-comment-' + idx);
  if (!commentEl) return;
  var comment = commentEl.value.trim();
  if (!comment) { commentEl.style.borderColor = '#c62828'; return; }
  try {
    var res = await fetch('/api/requests/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: file, comment: comment })
    });
    var data = await res.json();
    if (!data.ok) { alert('Error: ' + (data.error || 'Unknown')); return; }
  } catch (e) { alert('Network error'); return; }
  await loadRequests();
}
`;
}

module.exports = { getRequestsTabJS };
