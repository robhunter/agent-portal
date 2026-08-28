// tabs/capabilities.js — Capabilities tab client-side JS
// Renders MCP servers, scripts/tools, instructions, skills, and workspaces

function getCapabilitiesTabJS() {
  return `
// --- Capabilities tab ---
function capFormatBytes(n) {
  if (typeof n !== 'number') return '';
  return n < 1024 ? n + 'B' : Math.round(n / 1024) + 'KB';
}

function capFormatDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function capExpandableCard(opts) {
  var meta = (opts.meta || []).filter(Boolean).join(' \\u00b7 ');
  return '<details class="status-card" style="padding:0">'
    + '<summary style="padding:14px 18px;cursor:pointer">'
    + '<span style="display:inline-flex;align-items:center;gap:12px;width:calc(100% - 24px);vertical-align:middle">'
    + '<span style="width:36px;height:36px;border-radius:8px;background:' + opts.iconBg + ';display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">'
    + '<span style="font-size:16px">' + opts.icon + '</span></span>'
    + '<span style="flex:1;min-width:0">'
    + '<span style="display:block;font-weight:600;font-size:14px">' + escapeHtml(opts.title) + '</span>'
    + (opts.subtitle ? '<span style="display:block;font-size:12px;color:#888;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(opts.subtitle) + '</span>' : '')
    + '</span>'
    + (opts.pill ? '<span style="font-size:11px;color:#888;background:#f5f5f5;padding:2px 8px;border-radius:8px;flex-shrink:0">' + escapeHtml(opts.pill) + '</span>' : '')
    + (meta ? '<span style="font-size:11px;color:#aaa;flex-shrink:0">' + escapeHtml(meta) + '</span>' : '')
    + '</span></summary>'
    + '<div style="border-top:1px solid #eee;padding:12px 18px;background:#fafafa;border-radius:0 0 8px 8px">'
    + '<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;color:#333">'
    + escapeHtml(opts.content == null ? '' : String(opts.content))
    + '</pre></div></details>';
}

async function loadCapabilities() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading capabilities...</div>';
  try {
    var res = await fetch('/api/capabilities');
    var data = await res.json();
    var html = '<div style="max-width:800px">';

    html += '<div class="status-section"><h2>Instructions</h2>';
    var instructions = data.instructions || [];
    if (instructions.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No instruction files found.</div>';
    } else {
      var agentInstr = instructions.filter(function(i) { return i.scope !== 'shared'; });
      var sharedInstr = instructions.filter(function(i) { return i.scope === 'shared'; });

      agentInstr.forEach(function(i) {
        html += capExpandableCard({
          iconBg: '#e8eaf6',
          icon: '\\u{1F4D8}',
          title: i.label,
          subtitle: i.source,
          meta: [capFormatBytes(i.bytes), capFormatDate(i.modified)],
          content: i.content,
        });
      });

      if (sharedInstr.length > 0) {
        html += '<div style="display:flex;align-items:center;gap:10px;margin:16px 0 8px">'
          + '<div style="height:1px;background:#e8e8e8;flex:1"></div>'
          + '<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap">Shared \\u00b7 applies to every agent</div>'
          + '<div style="height:1px;background:#e8e8e8;flex:1"></div>'
          + '</div>';
        sharedInstr.forEach(function(i) {
          html += capExpandableCard({
            iconBg: '#eceff1',
            icon: '\\u{1F310}',
            title: i.label,
            subtitle: i.source,
            pill: 'read-only',
            meta: [capFormatBytes(i.bytes), capFormatDate(i.modified)],
            content: i.content,
          });
        });
      }
    }
    html += '</div>';

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
        html += capExpandableCard({
          iconBg: '#f3e5f5',
          icon: '\\u{1F4A1}',
          title: sk.description || sk.name,
          subtitle: sk.filename,
          meta: [capFormatBytes((sk.content || '').length)],
          content: sk.content,
        });
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
