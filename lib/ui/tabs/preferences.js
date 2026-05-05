// preferences.js — Per-category preferences tab client-side JavaScript
// Editable likes/dislikes per media category

function getPreferencesTabJS() {
  return `
var prefsData = {};
var prefsActiveCategory = null;
var ratedItemsByCategory = {};
var expandedRatedItem = null;
var editingRatedItem = null;

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
  html += '<div id="rated-items-' + escapeHtml(category) + '"></div>';
  html += '</div>';
  document.getElementById('content').innerHTML = html;
  loadRatedItems(category);
}

function pendingBadge(item) {
  if (item.processed_at) return '';
  return '<span title="Awaiting next agent cycle" style="font-size:10px;padding:1px 5px;border-radius:3px;background:#fff3e0;color:#e65100;margin-left:6px">pending</span>';
}

function ratingIcon(rating) {
  return rating === 'up'
    ? '<span style="color:#2e7d32;font-size:14px">👍</span>'
    : '<span style="color:#c62828;font-size:14px">👎</span>';
}

function renderRatedItemRow(item) {
  var isExpanded = expandedRatedItem === item.id;
  var isEditing = editingRatedItem === item.id;
  var html = '<div style="border:1px solid #eee;border-radius:4px;padding:8px 10px;margin-bottom:6px;background:#fafafa">';

  if (isEditing) {
    html += '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">';
    html += '<select id="rated-edit-rating-' + item.id + '" style="padding:4px;font-size:12px">';
    html += '<option value="up"' + (item.rating === 'up' ? ' selected' : '') + '>👍 Up</option>';
    html += '<option value="down"' + (item.rating === 'down' ? ' selected' : '') + '>👎 Down</option>';
    html += '</select>';
    html += '<input type="text" id="rated-edit-title-' + item.id + '" value="' + escapeHtml(item.title) + '" style="flex:1;padding:4px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-family:inherit">';
    html += '</div>';
    html += '<textarea id="rated-edit-desc-' + item.id + '" rows="3" placeholder="Description (why you liked/disliked it)" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px;font-family:inherit;resize:vertical">' + escapeHtml(item.description || '') + '</textarea>';
    html += '<div style="display:flex;gap:6px;margin-top:6px">';
    html += '<button class="refresh-btn" style="background:#1a73e8;color:#fff;border-color:#1a73e8;font-size:12px" onclick="saveRatedItem(\\'' + item.id + '\\')">Save</button>';
    html += '<button class="refresh-btn" style="font-size:12px" onclick="cancelEditRatedItem()">Cancel</button>';
    html += '</div>';
  } else {
    html += '<div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="toggleRatedItem(\\'' + item.id + '\\')">';
    html += '<div>' + ratingIcon(item.rating) + '</div>';
    html += '<div style="flex:1;font-size:13px;color:#333;font-weight:500">' + escapeHtml(item.title) + pendingBadge(item) + '</div>';
    html += '<button class="refresh-btn" style="padding:2px 6px;font-size:11px" onclick="event.stopPropagation();editRatedItem(\\'' + item.id + '\\')">Edit</button>';
    html += '<button class="refresh-btn" style="padding:2px 6px;font-size:11px;color:#c62828" onclick="event.stopPropagation();deleteRatedItem(\\'' + item.id + '\\')">×</button>';
    html += '</div>';
    if (isExpanded && item.description) {
      html += '<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #eee;font-size:12px;color:#555;white-space:pre-wrap">' + escapeHtml(item.description) + '</div>';
    }
  }
  html += '</div>';
  return html;
}

function renderRatedItemsSection(category) {
  var items = ratedItemsByCategory[category] || [];
  var html = '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee">';
  html += '<h4 style="margin:0 0 6px;font-size:14px;color:#555">📚 Rated content <span style="color:#999;font-weight:normal">(' + items.length + ')</span></h4>';
  html += '<p style="margin:0 0 10px;font-size:12px;color:#888">Add things you\\'ve seen, read, or played — the agent will use them to learn your taste on its next cycle.</p>';

  if (items.length === 0) {
    html += '<div style="font-size:12px;color:#999;font-style:italic;margin-bottom:10px">No rated items yet.</div>';
  } else {
    items.forEach(function(item) { html += renderRatedItemRow(item); });
  }

  // Add form
  html += '<div style="margin-top:12px;padding:10px;border:1px dashed #ccc;border-radius:4px;background:#fff">';
  html += '<div style="font-size:12px;color:#555;font-weight:600;margin-bottom:6px">Add rated content</div>';
  html += '<input type="text" id="rated-add-title-' + category + '" placeholder="Title (e.g. The Godfather)" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-family:inherit;margin-bottom:6px">';
  html += '<textarea id="rated-add-desc-' + category + '" rows="2" placeholder="Description — disambiguate (year, author, director...) and say what you liked or didn\\'t" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px;font-family:inherit;resize:vertical;margin-bottom:6px"></textarea>';
  html += '<div style="display:flex;gap:6px">';
  html += '<button class="refresh-btn" style="font-size:12px;background:#e8f5e9;border-color:#a5d6a7" onclick="addRatedItem(\\'' + category + '\\',\\'up\\')">👍 Add as Like</button>';
  html += '<button class="refresh-btn" style="font-size:12px;background:#ffebee;border-color:#ef9a9a" onclick="addRatedItem(\\'' + category + '\\',\\'down\\')">👎 Add as Dislike</button>';
  html += '</div>';
  html += '</div>';

  html += '</div>';
  return html;
}

async function loadRatedItems(category) {
  try {
    var res = await fetch('/api/rated-items?category=' + encodeURIComponent(category));
    ratedItemsByCategory[category] = await res.json();
  } catch {
    ratedItemsByCategory[category] = [];
  }
  var el = document.getElementById('rated-items-' + category);
  if (el) el.innerHTML = renderRatedItemsSection(category);
}

function toggleRatedItem(id) {
  expandedRatedItem = expandedRatedItem === id ? null : id;
  if (prefsActiveCategory) loadRatedItems(prefsActiveCategory);
}

function editRatedItem(id) {
  editingRatedItem = id;
  if (prefsActiveCategory) loadRatedItems(prefsActiveCategory);
}

function cancelEditRatedItem() {
  editingRatedItem = null;
  if (prefsActiveCategory) loadRatedItems(prefsActiveCategory);
}

async function saveRatedItem(id) {
  var titleEl = document.getElementById('rated-edit-title-' + id);
  var descEl = document.getElementById('rated-edit-desc-' + id);
  var ratingEl = document.getElementById('rated-edit-rating-' + id);
  if (!titleEl || !titleEl.value.trim()) { alert('Title required'); return; }
  try {
    await fetch('/api/rated-items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: id,
        title: titleEl.value.trim(),
        description: descEl ? descEl.value : '',
        rating: ratingEl ? ratingEl.value : 'up',
      })
    });
    editingRatedItem = null;
    if (prefsActiveCategory) loadRatedItems(prefsActiveCategory);
  } catch {
    alert('Failed to save');
  }
}

async function deleteRatedItem(id) {
  if (!confirm('Remove this rated item?')) return;
  try {
    await fetch('/api/rated-items', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id })
    });
    if (prefsActiveCategory) loadRatedItems(prefsActiveCategory);
  } catch {}
}

async function addRatedItem(category, rating) {
  var titleEl = document.getElementById('rated-add-title-' + category);
  var descEl = document.getElementById('rated-add-desc-' + category);
  if (!titleEl || !titleEl.value.trim()) { alert('Title required'); return; }
  try {
    await fetch('/api/rated-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: category,
        title: titleEl.value.trim(),
        description: descEl ? descEl.value.trim() : '',
        rating: rating,
      })
    });
    titleEl.value = '';
    if (descEl) descEl.value = '';
    loadRatedItems(category);
  } catch {
    alert('Failed to add');
  }
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
  // Add new category — opens dedicated onboarding flow
  html += '<button class="refresh-btn" style="padding:4px 12px;font-size:13px;color:#888" onclick="window.location.href=\\'/onboarding\\'">+ Category</button>';
  html += '</div>';
  return html;
}

async function loadPreferences() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading preferences...</div>';
  try {
    var res = await fetch('/api/preferences');
    prefsData = await res.json();

    // Honor ?category=... when arriving from the onboarding flow
    var urlCat = new URLSearchParams(window.location.search).get('category');
    if (urlCat && prefsData[urlCat]) prefsActiveCategory = urlCat;

    var categories = Object.keys(prefsData).sort();
    if (categories.length === 0) {
      var html = '<div class="status-section">';
      html += '<h2 style="margin:0 0 16px;font-size:18px">Taste Profile</h2>';
      html += '<p style="color:#666;font-size:13px;margin-bottom:16px">No preferences yet. Preferences are organized per media category — the agent will create them as you give feedback, or you can add categories manually.</p>';
      html += '<button class="refresh-btn" onclick="window.location.href=\\'/onboarding\\'">+ Add Category</button>';
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
