// tabs/health.js — Health tab client-side JS
// Renders health check entries in a reverse-chronological table

function getHealthTabJS() {
  return `
// --- Health tab ---
async function loadHealth() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading health data...</div>';
  try {
    const res = await fetch('/api/health');
    const entries = await res.json();
    let html = '<div class="status-section"><h2>Health Checks</h2>';
    if (!Array.isArray(entries) || entries.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No health check data yet.</div>';
    } else {
      html += '<table class="md-content" style="width:100%;border-collapse:collapse">';
      html += '<thead><tr><th>Timestamp</th><th>Project</th><th>Endpoint</th><th>Status</th><th>Latency</th><th>OK</th></tr></thead><tbody>';
      entries.slice().reverse().forEach(function(e) {
        const okLabel = e.ok ? '\\u2713' : '\\u2717';
        const okColor = e.ok ? '#2e7d32' : '#c62828';
        html += '<tr>'
          + '<td>' + formatTimestamp(e.ts || '') + '</td>'
          + '<td>' + escapeHtml(e.project || '') + '</td>'
          + '<td style="font-family:monospace;font-size:12px">' + escapeHtml(e.endpoint || '') + '</td>'
          + '<td>' + (e.status || '\\u2014') + '</td>'
          + '<td>' + (e.latency_ms != null ? e.latency_ms + 'ms' : '\\u2014') + '</td>'
          + '<td style="color:' + okColor + ';font-weight:bold">' + okLabel + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    contentEl.innerHTML = html;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load health data</div>';
  }
}
`;
}

module.exports = { getHealthTabJS };
