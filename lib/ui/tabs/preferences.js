// preferences.js — Per-category preferences tab client-side JavaScript
// Editable likes/dislikes per media category

function getPreferencesTabJS() {
  return `
var prefsData = {};
var prefsActiveCategory = null;

function renderPrefsSection(category, section, items, label) {
  var html = '<div style="margin-bottom:20px">';
  html += '<h4 style="margin:0 0 6px;font-size:14px;color:#555">' + escapeHtml(label) + ' <span style="color:#999;font-weight:normal">(' + items.length + ')</span></h4>';

  items.forEach(function(item, idx) {
    var srcBadge = item.source === 'agent'
      ? '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#ede7f6;color:#4527a0;margin-left:6px">agent</span>'
      : '<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:#e3f2fd;color:#1565c0;margin-left:6px">user</span>';

    html += '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:4px;margin-bottom:3px;background:#fafafa">';
    html += '<div style="flex:1;font-size:13px;color:#333">' + escapeHtml(item.text || '') + srcBadge + '</div>';
    html += '<button class="refresh-btn" style="padding:2px 6px;font-size:11px" onclick="editPref(\\'' + escapeHtml(category) + '\\',\\'' + section + '\\',' + idx + ')">Edit</button>';
    html += '<button class="refresh-btn" style="padding:2px 6px;font-size:11px;color:#c62828" onclick="deletePref(\\'' + escapeHtml(category) + '\\',\\'' + section + '\\',' + idx + ')">×</button>';
    html += '</div>';
  });

  html += '<div style="display:flex;gap:6px;margin-top:6px">';
  html += '<input type="text" id="pref-add-' + category + '-' + section + '" placeholder="Add..." style="flex:1;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px;font-family:inherit">';
  html += '<button class="refresh-btn" style="font-size:12px" onclick="addPref(\\'' + escapeHtml(category) + '\\',\\'' + section + '\\')">Add</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function renderCategoryPrefs(category) {
  prefsActiveCategory = category;
  var cat = prefsData[category] || { likes: [], dislikes: [] };
  var html = '<div class="status-section">';
  html += renderPrefsCategoryNav(category);
  html += '<h3 style="margin:0 0 12px;font-size:16px;text-transform:capitalize">' + escapeHtml(category) + '</h3>';
  html += renderPrefsSection(category, 'likes', cat.likes || [], '👍 Likes');
  html += renderPrefsSection(category, 'dislikes', cat.dislikes || [], '👎 Dislikes');
  html += '</div>';
  document.getElementById('content').innerHTML = html;
}

function renderPrefsCategoryNav(activeCategory) {
  var categories = Object.keys(prefsData).sort();
  var html = '<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">';
  categories.forEach(function(cat) {
    var isActive = cat === activeCategory;
    var likes = (prefsData[cat] && prefsData[cat].likes) ? prefsData[cat].likes.length : 0;
    var dislikes = (prefsData[cat] && prefsData[cat].dislikes) ? prefsData[cat].dislikes.length : 0;
    var count = likes + dislikes;
    html += '<button class="refresh-btn" style="padding:4px 12px;font-size:13px;text-transform:capitalize;'
      + (isActive ? 'background:#1a73e8;color:#fff;border-color:#1a73e8' : '') + '" '
      + 'onclick="renderCategoryPrefs(\\'' + escapeHtml(cat) + '\\')">'
      + escapeHtml(cat) + ' <span style="opacity:0.7">(' + count + ')</span></button>';
  });
  // Add new category button
  html += '<button class="refresh-btn" style="padding:4px 12px;font-size:13px;color:#888" onclick="addCategory()">+ Category</button>';
  html += '</div>';
  return html;
}

async function loadPreferences() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading preferences...</div>';
  try {
    var res = await fetch('/api/preferences');
    prefsData = await res.json();

    var categories = Object.keys(prefsData).sort();
    if (categories.length === 0) {
      var html = '<div class="status-section">';
      html += '<h2 style="margin:0 0 16px;font-size:18px">Taste Profile</h2>';
      html += '<p style="color:#666;font-size:13px;margin-bottom:16px">No preferences yet. Preferences are organized per media category — the agent will create them as you give feedback, or you can add categories manually.</p>';
      html += '<button class="refresh-btn" onclick="addCategory()">+ Add Category</button>';
      html += '</div>';
      contentEl.innerHTML = html;
    } else {
      var active = prefsActiveCategory && categories.includes(prefsActiveCategory) ? prefsActiveCategory : categories[0];
      renderCategoryPrefs(active);
    }
  } catch {
    contentEl.innerHTML = '<div class="empty">Failed to load preferences</div>';
  }
}

var showingCategoryForm = false;

function addCategory() {
  if (showingCategoryForm) return;
  showingCategoryForm = true;
  var contentEl = document.getElementById('content');
  var categories = Object.keys(prefsData).sort();

  var html = '<div class="status-section">';
  if (categories.length > 0) {
    html += renderPrefsCategoryNav(null);
  }
  html += '<h3 style="margin:0 0 12px;font-size:16px">Add Category</h3>';
  html += '<div style="margin-bottom:12px">';
  html += '<label style="display:block;font-size:13px;color:#555;margin-bottom:4px;font-weight:600">Category name</label>';
  html += '<input type="text" id="new-cat-name" placeholder="e.g. audiobooks, comics, movies..." style="width:100%;max-width:300px;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-family:inherit;box-sizing:border-box">';
  html += '</div>';
  html += '<div style="margin-bottom:12px">';
  html += '<label style="display:block;font-size:13px;color:#555;margin-bottom:4px;font-weight:600">Tell ContentBot about your preferences</label>';
  html += '<textarea id="new-cat-context" rows="5" placeholder="Describe what you like in this category. You might mention:\\n- What kinds of content you enjoy\\n- Formats you prefer (epub, audiobook, cbz...)\\n- Where you currently get this content\\n- What you don\\'t want\\n\\nExample: I listen on Libby mostly. I like narrative nonfiction, author-narrated, under 12 hours. Can\\'t track complex character casts in audio." style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-family:inherit;resize:vertical;line-height:1.5"></textarea>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px">';
  html += '<button class="refresh-btn" style="background:#1a73e8;color:#fff;border-color:#1a73e8" onclick="submitNewCategory()">Create Category</button>';
  html += '<button class="refresh-btn" onclick="cancelNewCategory()">Cancel</button>';
  html += '</div>';
  html += '</div>';
  contentEl.innerHTML = html;
}

function cancelNewCategory() {
  showingCategoryForm = false;
  loadPreferences();
}

async function submitNewCategory() {
  var nameEl = document.getElementById('new-cat-name');
  var contextEl = document.getElementById('new-cat-context');
  var name = nameEl ? nameEl.value.trim() : '';
  var context = contextEl ? contextEl.value.trim() : '';

  if (!name) { alert('Please enter a category name'); return; }
  if (!context) { alert('Please describe your preferences for this category — it helps ContentBot make better recommendations from the start'); return; }

  var key = name.toLowerCase().replace(/\\s+/g, '-');

  try {
    // Submit the freeform context as a category request for the agent to process
    await fetch('/api/preferences/category-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: key, context: context })
    });
    showingCategoryForm = false;
    // Also create the category locally so it appears immediately
    if (!prefsData[key]) prefsData[key] = { likes: [], dislikes: [] };
    renderCategoryPrefs(key);
  } catch {
    alert('Failed to create category');
  }
}

async function addPref(category, section) {
  var input = document.getElementById('pref-add-' + category + '-' + section);
  if (!input || !input.value.trim()) return;
  try {
    await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category, section: section, text: input.value.trim() })
    });
    var res = await fetch('/api/preferences');
    prefsData = await res.json();
    renderCategoryPrefs(category);
  } catch {}
}

async function editPref(category, section, index) {
  var cat = prefsData[category] || {};
  var items = cat[section] || [];
  var current = items[index] ? items[index].text : '';
  var newText = prompt('Edit preference:', current);
  if (newText === null || newText.trim() === '' || newText === current) return;
  try {
    await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category, section: section, index: index, text: newText.trim() })
    });
    var res = await fetch('/api/preferences');
    prefsData = await res.json();
    renderCategoryPrefs(category);
  } catch {}
}

async function deletePref(category, section, index) {
  if (!confirm('Remove this preference?')) return;
  try {
    await fetch('/api/preferences', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: category, section: section, index: index })
    });
    var res = await fetch('/api/preferences');
    prefsData = await res.json();
    renderCategoryPrefs(category);
  } catch {}
}
`;
}

module.exports = { getPreferencesTabJS };
