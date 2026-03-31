// tabs/capabilities.js — Capabilities tab client-side JS
// Renders MCP servers, scripts/tools, skills, and workspaces

function getCapabilitiesTabJS() {
  return `
// --- Capabilities tab ---
async function loadCapabilities() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading capabilities...</div>';
  try {
    var res = await fetch('/api/capabilities');
    var data = await res.json();
    var html = '<div style="max-width:800px">';

    // MCP Servers
    html += '<div class="status-section"><h2>MCP Servers</h2>';
    if (!data.mcpServers || data.mcpServers.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No MCP servers discovered.</div>';
    } else {
      data.mcpServers.forEach(function(srv) {
        html += '<div class="status-card" style="display:flex;align-items:center;gap:12px">'
          + '<div style="width:36px;height:36px;border-radius:8px;background:#e3f2fd;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          + '<span style="font-size:16px">\\u2699</span></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:14px">' + escapeHtml(srv.name) + '</div>'
          + (srv.url ? '<div style="font-size:12px;color:#888;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(srv.url) + '</div>' : '')
          + (srv.command ? '<div style="font-size:12px;color:#888;font-family:monospace">cmd: ' + escapeHtml(Array.isArray(srv.command) ? srv.command.join(' ') : srv.command) + '</div>' : '')
          + '</div>'
          + '<span style="font-size:11px;color:#888;background:#f5f5f5;padding:2px 8px;border-radius:8px;flex-shrink:0">' + escapeHtml(srv.source || 'local') + '</span>'
          + '</div>';
      });
    }
    html += '</div>';

    // Scripts & Tools
    html += '<div class="status-section"><h2>Scripts &amp; Tools</h2>';
    if (!data.scripts || data.scripts.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No scripts found in tools/.</div>';
    } else {
      data.scripts.forEach(function(s) {
        html += '<div class="status-card" style="display:flex;align-items:center;gap:12px">'
          + '<div style="width:36px;height:36px;border-radius:8px;background:#e8f5e9;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          + '<span style="font-size:16px">\\u{1F4DC}</span></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:14px;font-family:monospace">' + escapeHtml(s.name) + '</div>'
          + (s.description ? '<div style="font-size:13px;color:#555">' + escapeHtml(s.description) + '</div>' : '')
          + '</div>'
          + '<span style="font-size:11px;color:#888">' + (s.size < 1024 ? s.size + 'B' : Math.round(s.size / 1024) + 'KB') + '</span>'
          + '</div>';
      });
    }
    html += '</div>';

    // Skills
    html += '<div class="status-section"><h2>Skills</h2>';
    if (!data.skills || data.skills.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No skills found in skills/.</div>';
    } else {
      data.skills.forEach(function(sk) {
        html += '<div class="status-card" style="display:flex;align-items:center;gap:12px">'
          + '<div style="width:36px;height:36px;border-radius:8px;background:#f3e5f5;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          + '<span style="font-size:16px">\\u{1F4A1}</span></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:14px">' + escapeHtml(sk.description || sk.name) + '</div>'
          + (sk.whenToUse ? '<div style="font-size:13px;color:#555">' + escapeHtml(sk.whenToUse) + '</div>' : '')
          + '<div style="font-size:11px;color:#aaa;margin-top:2px">' + escapeHtml(sk.filename) + '</div>'
          + '</div>'
          + '</div>';
      });
    }
    html += '</div>';

    // Workspaces
    html += '<div class="status-section"><h2>Managed Workspaces</h2>';
    if (!data.workspaces || data.workspaces.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No workspaces configured in agent.yaml.</div>';
    } else {
      data.workspaces.forEach(function(ws) {
        html += '<div class="status-card" style="display:flex;align-items:center;gap:12px">'
          + '<div style="width:36px;height:36px;border-radius:8px;background:#fff3e0;display:flex;align-items:center;justify-content:center;flex-shrink:0">'
          + '<span style="font-size:16px">\\u{1F4C2}</span></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-weight:600;font-size:14px">' + escapeHtml(ws.repo) + '</div>'
          + (ws.path ? '<div style="font-size:12px;color:#888;font-family:monospace">' + escapeHtml(ws.path) + '</div>' : '')
          + '</div>'
          + '</div>';
      });
    }
    html += '</div>';

    html += '</div>';
    contentEl.innerHTML = html;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load capabilities</div>';
  }
}
`;
}

module.exports = { getCapabilitiesTabJS };
