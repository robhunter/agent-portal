// tabs/roadmap.js — Roadmap tab client-side JS
// Renders roadmap.md markdown in a card

function getRoadmapTabJS() {
  return `
// --- Roadmap tab ---
async function loadRoadmap() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading roadmap...</div>';
  try {
    const res = await fetch('/api/roadmap');
    const data = await res.json();
    contentEl.innerHTML = '<div class="status-section"><div class="status-card"><div class="md-content">' + marked.parse(data.content || '*No roadmap.md*') + '</div></div></div>';
    contentEl.querySelectorAll('.md-content a').forEach(function(a) { a.target = '_blank'; a.rel = 'noopener'; });
    contentEl.scrollTop = 0;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load roadmap</div>';
  }
}
`;
}

module.exports = { getRoadmapTabJS };
