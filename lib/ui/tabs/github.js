// tabs/github.js — GitHub tab client-side JS
// Returns a string of JS for rendering GitHub issues and PRs

function getGitHubTabJS() {
  return `
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
`;
}

module.exports = { getGitHubTabJS };
