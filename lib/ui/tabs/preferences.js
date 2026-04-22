// preferences.js — Preferences tab client-side JavaScript
// Editable lists of likes, dislikes, and notes (follows todos tab pattern)

function getPreferencesTabJS() {
  return `
var prefsData = { likes: [], dislikes: [], notes: [] };

function renderPrefsSection(section, items, label) {
  var html = '<div style="margin-bottom:24px">';
  html += '<h3 style="margin:0 0 8px;font-size:15px;color:#444">' + escapeHtml(label) + ' <span style="color:#999;font-weight:normal">(' + items.length + ')</span></h3>';

  items.forEach(function(item, idx) {
    var srcBadge = item.source === 'agent'
      ? '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#ede7f6;color:#4527a0;margin-left:6px">agent</span>'
      : '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#e3f2fd;color:#1565c0;margin-left:6px">user</span>';

    html += '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border-radius:4px;margin-bottom:4px;background:#fafafa">';
    html += '<div style="flex:1;font-size:13px;color:#333" id="pref-text-' + section + '-' + idx + '">' + escapeHtml(item.text || '') + srcBadge + '</div>';
    html += '<button class="refresh-btn" style="padding:2px 6px;font-size:11px" onclick="editPref(\\'' + section + '\\',' + idx + ')">Edit</button>';
    html += '<button class="refresh-btn" style="padding:2px 6px;font-size:11px;color:#c62828" onclick="deletePref(\\'' + section + '\\',' + idx + ')">×</button>';
    html += '</div>';
  });

  // Add new entry
  html += '<div style="display:flex;gap:6px;margin-top:8px">';
  html += '<input type="text" id="pref-add-' + section + '" placeholder="Add ' + section.slice(0, -1) + '..." style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-family:inherit">';
  html += '<button class="refresh-btn" onclick="addPref(\\'' + section + '\\')">Add</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

async function loadPreferences() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading preferences...</div>';
  try {
    var res = await fetch('/api/preferences');
    prefsData = await res.json();

    var html = '<div class="status-section">';
    html += '<h2 style="margin:0 0 16px;font-size:18px">Taste Profile</h2>';
    html += '<p style="color:#666;font-size:13px;margin-bottom:16px">These preferences guide ContentBot\\'s recommendations. The agent extracts patterns from your feedback; you can also add or edit entries directly.</p>';
    html += renderPrefsSection('likes', prefsData.likes || [], '👍 Likes');
    html += renderPrefsSection('dislikes', prefsData.dislikes || [], '👎 Dislikes');
    html += renderPrefsSection('notes', prefsData.notes || [], '📝 Notes');
    html += '</div>';

    contentEl.innerHTML = html;
    contentEl.scrollTop = 0;
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load preferences</div>';
  }
}

async function addPref(section) {
  var input = document.getElementById('pref-add-' + section);
  if (!input || !input.value.trim()) return;
  try {
    await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: section, text: input.value.trim() })
    });
    loadPreferences();
  } catch {}
}

async function editPref(section, index) {
  var items = prefsData[section] || [];
  var current = items[index] ? items[index].text : '';
  var newText = prompt('Edit preference:', current);
  if (newText === null || newText.trim() === '' || newText === current) return;
  try {
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: section, index: index, text: newText.trim() })
    });
    loadPreferences();
  } catch {}
}

async function deletePref(section, index) {
  if (!confirm('Remove this preference?')) return;
  try {
    await fetch('/api/preferences', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: section, index: index })
    });
    loadPreferences();
  } catch {}
}
`;
}

module.exports = { getPreferencesTabJS };
