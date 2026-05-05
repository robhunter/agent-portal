// routes/onboarding.js — Standalone onboarding flow for adding a new category.
// Step 1: category name + freeform likes/dislikes description.
// Step 2: 1+ pieces of content the user specifically likes (title + description).
// Posts to existing /api/preferences/category-request and /api/rated-items.
// Registered when features.library is configured.

function register(routes, config) {
  if (!config.features || !config.features.library) return;

  const agentName = (config && config.name) || 'Agent';

  routes['GET /onboarding'] = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderOnboardingHTML(agentName));
  };
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderOnboardingHTML(agentName) {
  const safeName = escapeHtml(agentName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Add a category — ${safeName}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#f5f5f5; color:#222; }
  .wrap { max-width:680px; margin:0 auto; padding:32px 24px 64px; }
  header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
  header h1 { margin:0; font-size:22px; font-weight:600; }
  header a { color:#1a73e8; text-decoration:none; font-size:13px; }
  header a:hover { text-decoration:underline; }
  .card { background:#fff; border:1px solid #e0e0e0; border-radius:8px; padding:20px 22px; box-shadow:0 1px 2px rgba(0,0,0,0.03); }
  .card + .card { margin-top:16px; }
  .step-label { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#888; margin:0 0 4px; }
  .card h2 { margin:0 0 6px; font-size:17px; font-weight:600; }
  .card p.hint { margin:0 0 14px; font-size:13px; color:#666; line-height:1.45; }
  label { display:block; font-size:12px; font-weight:600; color:#555; margin:10px 0 4px; }
  input[type=text], textarea {
    width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #ccc; border-radius:5px;
    font-size:13px; font-family:inherit; line-height:1.45; background:#fff;
  }
  textarea { resize:vertical; }
  input[type=text]:focus, textarea:focus { outline:none; border-color:#1a73e8; box-shadow:0 0 0 2px rgba(26,115,232,0.15); }
  .row { display:flex; gap:10px; align-items:flex-start; }
  .row > * { flex:1; }
  .item { border:1px solid #eee; border-radius:6px; padding:12px; margin-bottom:10px; background:#fafafa; }
  .item-head { display:flex; gap:8px; align-items:center; margin-bottom:6px; }
  .item-head .badge { font-size:11px; color:#666; font-weight:500; }
  .item-head .remove { margin-left:auto; background:none; border:none; color:#c62828; font-size:13px; cursor:pointer; padding:2px 6px; }
  .add-item-btn {
    display:inline-block; background:none; border:1px dashed #aaa; border-radius:6px; padding:8px 14px;
    font-size:12px; color:#555; cursor:pointer;
  }
  .add-item-btn:hover { background:#fff; border-color:#1a73e8; color:#1a73e8; }
  .actions { margin-top:24px; display:flex; gap:10px; align-items:center; }
  button.primary {
    background:#1a73e8; color:#fff; border:1px solid #1a73e8; padding:9px 18px; border-radius:5px;
    font-size:13px; font-weight:500; cursor:pointer;
  }
  button.primary:hover { background:#1557b0; border-color:#1557b0; }
  button.primary[disabled] { opacity:0.5; cursor:not-allowed; }
  button.secondary {
    background:#fff; color:#444; border:1px solid #ccc; padding:9px 14px; border-radius:5px;
    font-size:13px; cursor:pointer;
  }
  .error { color:#c62828; font-size:12px; margin-top:8px; }
  .success { background:#e8f5e9; border:1px solid #a5d6a7; padding:14px; border-radius:6px; font-size:13px; color:#2e7d32; }
  .success a { color:#1565c0; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Add a category</h1>
    <a href="/?tab=preferences" id="back-link">← Back to ${safeName}</a>
  </header>

  <div id="form-area">
    <div class="card">
      <div class="step-label">Step 1 of 2</div>
      <h2>Tell us about the category</h2>
      <p class="hint">What kind of content is this, and what shapes your taste? Be specific — formats you prefer, where you usually find this content, things you don't want.</p>
      <label for="cat-name">Category name</label>
      <input type="text" id="cat-name" placeholder="e.g. movies, audiobooks, games" autocomplete="off">
      <label for="cat-context">Likes &amp; dislikes</label>
      <textarea id="cat-context" rows="6" placeholder="I watch on Netflix and Letterboxd is my source of truth. Love mid-budget character dramas, dark comedies, anything with a director who shoots on film. Avoid superhero and most franchise tentpoles."></textarea>
    </div>

    <div class="card">
      <div class="step-label">Step 2 of 2</div>
      <h2>Add a few things you like</h2>
      <p class="hint">Specific items help the agent calibrate fast. Title is required; the description is where you say which one (year, director, author...) and what you like about it.</p>
      <div id="items"></div>
      <button type="button" class="add-item-btn" onclick="addItemRow()">+ Add another</button>
    </div>

    <div class="actions">
      <button type="button" class="primary" id="submit-btn" onclick="submitOnboarding()">Create category</button>
      <button type="button" class="secondary" onclick="window.location='/?tab=preferences'">Cancel</button>
      <span class="error" id="error-msg"></span>
    </div>
  </div>

  <div id="success-area" style="display:none">
    <div class="success">
      <strong>Category created.</strong> The agent will read your items on its next cycle and extract preferences. <a id="success-link" href="/?tab=preferences">View it in Preferences →</a>
    </div>
  </div>
</div>

<script>
function escapeAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

var itemRows = [];
var nextRowId = 1;

function addItemRow() {
  // Preserve any values the user has typed into existing rows before re-rendering
  captureItems();
  var rowId = nextRowId++;
  itemRows.push(rowId);
  renderItems();
  setTimeout(function() {
    var el = document.getElementById('item-title-' + rowId);
    if (el) el.focus();
  }, 0);
}

function removeItemRow(rowId) {
  // Capture user input first so renderItems doesn't blow away values
  captureItems();
  itemRows = itemRows.filter(function(r) { return r !== rowId; });
  delete capturedItems[rowId];
  if (itemRows.length === 0) addItemRow();
  else renderItems();
}

var capturedItems = {};

function captureItems() {
  itemRows.forEach(function(rowId) {
    var t = document.getElementById('item-title-' + rowId);
    var d = document.getElementById('item-desc-' + rowId);
    if (t || d) capturedItems[rowId] = { title: t ? t.value : '', description: d ? d.value : '' };
  });
}

function renderItems() {
  var container = document.getElementById('items');
  var html = '';
  itemRows.forEach(function(rowId, i) {
    var v = capturedItems[rowId] || { title: '', description: '' };
    html += '<div class="item">'
      + '<div class="item-head"><span class="badge">Item ' + (i + 1) + '</span>'
      + (itemRows.length > 1 ? '<button type="button" class="remove" onclick="removeItemRow(' + rowId + ')">Remove</button>' : '')
      + '</div>'
      + '<input type="text" id="item-title-' + rowId + '" placeholder="Title" value="' + escapeAttr(v.title) + '">'
      + '<textarea id="item-desc-' + rowId + '" rows="2" placeholder="Year, author, director... and why you like it">' + escapeHtml(v.description) + '</textarea>'
      + '</div>';
  });
  container.innerHTML = html;
}

function showError(msg) {
  document.getElementById('error-msg').textContent = msg || '';
}

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function submitOnboarding() {
  showError('');
  var nameEl = document.getElementById('cat-name');
  var contextEl = document.getElementById('cat-context');
  var name = nameEl.value.trim();
  var context = contextEl.value.trim();

  if (!name) { showError('Category name is required'); nameEl.focus(); return; }
  if (!context) { showError('Tell the agent something about your taste in this category — even a sentence helps'); contextEl.focus(); return; }

  captureItems();
  var items = itemRows
    .map(function(rowId) { return capturedItems[rowId]; })
    .filter(function(it) { return it && it.title && it.title.trim(); });

  if (items.length === 0) { showError('Add at least one piece of content you like'); return; }

  var btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Creating...';

  var slug = slugify(name);

  try {
    // Step 1: category-request (writes feedback file + creates empty category)
    var r1 = await fetch('/api/preferences/category-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: slug, context: context })
    });
    if (!r1.ok) {
      var e1 = await r1.json().catch(function() { return {}; });
      throw new Error(e1.error || 'Failed to create category');
    }
    var d1 = await r1.json();
    var finalSlug = d1.category || slug;

    // Step 2: post each rated item as 'up'
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var r2 = await fetch('/api/rated-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: finalSlug,
          title: it.title.trim(),
          description: (it.description || '').trim(),
          rating: 'up',
        })
      });
      if (!r2.ok) {
        var e2 = await r2.json().catch(function() { return {}; });
        throw new Error('Item "' + it.title + '" failed: ' + (e2.error || 'unknown'));
      }
    }

    // Success — show confirmation, link back to Preferences with this category
    document.getElementById('form-area').style.display = 'none';
    document.getElementById('success-area').style.display = 'block';
    document.getElementById('success-link').href = '/?tab=preferences&category=' + encodeURIComponent(finalSlug);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Create category';
    showError(err.message || 'Something went wrong');
  }
}

addItemRow();
</script>
</body>
</html>`;
}

module.exports = { register, renderOnboardingHTML };
