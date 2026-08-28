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

var capInstructions = [];
var capCycleRunning = false;

function capBodyId(id) { return 'instr-body-' + id; }

function capRenderView(entry) {
  var actions = '';
  if (entry.editable) {
    actions = capCycleRunning
      ? '<button disabled title="A cycle is running" style="opacity:.5;cursor:not-allowed;font-size:12px;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fafafa">Edit</button>'
      : '<button onclick="capStartEdit(\\'' + entry.id + '\\')" style="font-size:12px;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Edit</button>';
  }
  if (entry.editable) {
    actions = '<button onclick="capShowHistory(\\'' + entry.id + '\\')" style="font-size:12px;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">History</button>' + actions;
  }
  return (actions ? '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">' + actions + '</div>' : '')
    + '<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;color:#333">'
    + escapeHtml(entry.content == null ? '' : String(entry.content))
    + '</pre>';
}

function capRenderEditor(entry) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px">'
    + '<span id="instr-msg-' + entry.id + '" style="font-size:12px;color:#b00"></span>'
    + '<span style="display:flex;gap:8px">'
    + '<button onclick="capCancelEdit(\\'' + entry.id + '\\')" style="font-size:12px;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Cancel</button>'
    + '<button id="instr-save-' + entry.id + '" onclick="capSaveEdit(\\'' + entry.id + '\\')" style="font-size:12px;padding:4px 12px;border:1px solid #1565c0;border-radius:6px;background:#1565c0;color:#fff;cursor:pointer">Save</button>'
    + '</span></div>'
    + '<textarea id="instr-ta-' + entry.id + '" spellcheck="false" style="width:100%;min-height:320px;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;padding:10px;border:1px solid #ddd;border-radius:6px">'
    + escapeHtml(entry.content == null ? '' : String(entry.content))
    + '</textarea>';
}

async function capShowHistory(id) {
  var entry = capInstructions.find(function(i) { return i.id === id; });
  if (!entry) return;
  var body = document.getElementById(capBodyId(id));
  body.innerHTML = '<div class="empty">Loading history...</div>';
  try {
    var res = await fetch('/api/instructions/' + encodeURIComponent(id) + '/history');
    var data = await res.json();
    var revs = data.revisions || [];
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      + '<span style="font-size:12px;color:#888">' + revs.length + ' revision' + (revs.length === 1 ? '' : 's') + '</span>'
      + '<button onclick="capCancelEdit(\\'' + id + '\\')" style="font-size:12px;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Back</button>'
      + '</div>';
    if (revs.length === 0) {
      html += '<div style="color:#999;font-size:13px">No git history for this file.</div>';
    } else {
      revs.forEach(function(r) {
        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #eee">'
          + '<span style="font-family:monospace;font-size:12px;color:#888;flex-shrink:0">' + escapeHtml(r.sha.slice(0, 7)) + '</span>'
          + '<span style="flex:1;min-width:0"><span style="display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.message || '') + '</span>'
          + '<span style="display:block;font-size:11px;color:#aaa">' + escapeHtml(capFormatDate(r.date)) + (r.bytes ? ' \\u00b7 ' + capFormatBytes(r.bytes) : '') + '</span></span>'
          + '<button onclick="capViewRevision(\\'' + id + '\\',\\'' + r.sha + '\\')" style="font-size:12px;padding:3px 9px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;flex-shrink:0">View</button>'
          + (capCycleRunning ? '' : '<button onclick="capRestoreRevision(\\'' + id + '\\',\\'' + r.sha + '\\')" style="font-size:12px;padding:3px 9px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;flex-shrink:0">Restore</button>')
          + '</div>';
      });
    }
    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = '<div class="empty">Failed to load history</div>';
  }
}

async function capViewRevision(id, sha) {
  var body = document.getElementById(capBodyId(id));
  try {
    var res = await fetch('/api/instructions/' + encodeURIComponent(id) + '/history/' + encodeURIComponent(sha));
    var data = await res.json();
    if (!res.ok) { body.innerHTML = '<div class="empty">' + escapeHtml(data.error || 'Not found') + '</div>'; return; }
    body.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      + '<span style="font-family:monospace;font-size:12px;color:#888">' + escapeHtml(sha.slice(0, 7)) + '</span>'
      + '<button onclick="capShowHistory(\\'' + id + '\\')" style="font-size:12px;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Back to history</button>'
      + '</div>'
      + '<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;color:#333">'
      + escapeHtml(data.content == null ? '' : String(data.content)) + '</pre>';
  } catch (err) {
    body.innerHTML = '<div class="empty">Failed to load revision</div>';
  }
}

async function capRestoreRevision(id, sha) {
  var entry = capInstructions.find(function(i) { return i.id === id; });
  if (!entry) return;
  if (!confirm('Restore ' + entry.label + ' to revision ' + sha.slice(0, 7) + '? This writes the file and takes effect at the next wake.')) return;
  var body = document.getElementById(capBodyId(id));
  try {
    var got = await fetch('/api/instructions/' + encodeURIComponent(id) + '/history/' + encodeURIComponent(sha));
    var rev = await got.json();
    if (!got.ok) { body.innerHTML = '<div class="empty">' + escapeHtml(rev.error || 'Not found') + '</div>'; return; }
    var res = await fetch('/api/instructions/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: rev.content, modified: entry.modified }),
    });
    var out = await res.json();
    if (!res.ok) {
      body.innerHTML = '<div style="color:#b00;font-size:13px;margin-bottom:8px">' + escapeHtml(out.error || 'Restore failed') + '</div>'
        + '<button onclick="capShowHistory(\\'' + id + '\\')" style="font-size:12px;padding:4px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer">Back to history</button>';
      return;
    }
    entry.content = rev.content;
    entry.modified = out.modified;
    entry.bytes = out.bytes;
    body.innerHTML = capRenderView(entry);
  } catch (err) {
    body.innerHTML = '<div class="empty">Restore failed</div>';
  }
}

function capStartEdit(id) {
  if (capCycleRunning) return;
  var entry = capInstructions.find(function(i) { return i.id === id; });
  if (!entry) return;
  document.getElementById(capBodyId(id)).innerHTML = capRenderEditor(entry);
}

function capCancelEdit(id) {
  var entry = capInstructions.find(function(i) { return i.id === id; });
  if (!entry) return;
  document.getElementById(capBodyId(id)).innerHTML = capRenderView(entry);
}

async function capSaveEdit(id) {
  var entry = capInstructions.find(function(i) { return i.id === id; });
  if (!entry) return;
  var ta = document.getElementById('instr-ta-' + id);
  var msg = document.getElementById('instr-msg-' + id);
  var btn = document.getElementById('instr-save-' + id);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    var res = await fetch('/api/instructions/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ta.value, modified: entry.modified }),
    });
    var out = await res.json();
    if (!res.ok) {
      if (msg) msg.textContent = out.error || ('Save failed (' + res.status + ')');
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      return;
    }
    entry.content = ta.value;
    entry.modified = out.modified;
    entry.bytes = out.bytes;
    document.getElementById(capBodyId(id)).innerHTML = capRenderView(entry);
  } catch (err) {
    if (msg) msg.textContent = 'Save failed';
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
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
    + '<div' + (opts.bodyId ? ' id="' + opts.bodyId + '"' : '') + ' style="border-top:1px solid #eee;padding:12px 18px;background:#fafafa;border-radius:0 0 8px 8px">'
    + (opts.body != null ? opts.body
        : '<pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;color:#333">'
          + escapeHtml(opts.content == null ? '' : String(opts.content)) + '</pre>')
    + '</div></details>';
}

async function loadCapabilities() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading capabilities...</div>';
  try {
    var results = await Promise.all([fetch('/api/capabilities'), fetch('/api/instructions')]);
    var data = await results[0].json();
    var instrData = await results[1].json();
    capInstructions = instrData.instructions || data.instructions || [];
    capCycleRunning = !!instrData.cycleRunning;
    var html = '<div style="max-width:800px">';

    html += '<div class="status-section"><h2>Instructions</h2>';
    if (capCycleRunning) {
      html += '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#7a5c00">'
        + 'A cycle is running \\u2014 editing is disabled until it finishes. Saved changes take effect at the next wake.'
        + '</div>';
    }
    var instructions = capInstructions;
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
          bodyId: capBodyId(i.id),
          body: capRenderView(i),
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
