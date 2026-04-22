// library.js — Library tab client-side JavaScript
// Card-based media grid with filtering, detail view, YouTube embeds, and feedback

function getLibraryTabJS() {
  return `
var libraryItems = [];
var libraryFilters = { category: '', source: '', rating: '', search: '' };
var librarySort = 'discovered';

function getCategoryColor(cat) {
  var colors = {
    books: '#1565c0', audiobooks: '#6a1b9a', comics: '#e65100',
    'short-form-video': '#c62828', movies: '#2e7d32', music: '#00838f',
    'tv-shows': '#4527a0'
  };
  return colors[cat] || '#616161';
}

function getCategoryIcon(cat) {
  var icons = {
    books: '📖', audiobooks: '🎧', comics: '💥',
    'short-form-video': '▶️', movies: '🎬', music: '🎵',
    'tv-shows': '📺'
  };
  return icons[cat] || '📄';
}

function renderLibraryGrid() {
  var items = libraryItems.slice();
  // Apply filters
  if (libraryFilters.category) items = items.filter(function(i) { return i.category === libraryFilters.category; });
  if (libraryFilters.source) items = items.filter(function(i) { return i.source === libraryFilters.source; });
  if (libraryFilters.rating === 'up') items = items.filter(function(i) { return i.rating === 'up'; });
  else if (libraryFilters.rating === 'down') items = items.filter(function(i) { return i.rating === 'down'; });
  else if (libraryFilters.rating === 'unrated') items = items.filter(function(i) { return !i.rating; });
  if (libraryFilters.search) {
    var q = libraryFilters.search.toLowerCase();
    items = items.filter(function(i) { return i.title && i.title.toLowerCase().includes(q); });
  }
  // Sort
  if (librarySort === 'title') items.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
  else items.sort(function(a, b) {
    var da = a.discovered ? new Date(a.discovered) : new Date(0);
    var db = b.discovered ? new Date(b.discovered) : new Date(0);
    return db - da;
  });

  // Build categories and sources for filter dropdowns
  var cats = {};
  var srcs = {};
  libraryItems.forEach(function(i) {
    if (i.category) cats[i.category] = true;
    if (i.source) srcs[i.source] = true;
  });

  var html = '<div class="library-filter-bar">';
  html += '<select id="lib-cat-filter" onchange="libraryFilters.category=this.value;renderLibraryGrid()">';
  html += '<option value="">All categories</option>';
  Object.keys(cats).sort().forEach(function(c) {
    html += '<option value="' + c + '"' + (libraryFilters.category === c ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>';
  });
  html += '</select>';

  html += '<select id="lib-src-filter" onchange="libraryFilters.source=this.value;renderLibraryGrid()">';
  html += '<option value="">All sources</option>';
  Object.keys(srcs).sort().forEach(function(s) {
    html += '<option value="' + s + '"' + (libraryFilters.source === s ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
  });
  html += '</select>';

  html += '<select id="lib-rating-filter" onchange="libraryFilters.rating=this.value;renderLibraryGrid()">';
  html += '<option value=""' + (!libraryFilters.rating ? ' selected' : '') + '>All ratings</option>';
  html += '<option value="up"' + (libraryFilters.rating === 'up' ? ' selected' : '') + '>👍 Liked</option>';
  html += '<option value="down"' + (libraryFilters.rating === 'down' ? ' selected' : '') + '>👎 Disliked</option>';
  html += '<option value="unrated"' + (libraryFilters.rating === 'unrated' ? ' selected' : '') + '>Unrated</option>';
  html += '</select>';

  html += '<select id="lib-sort" onchange="librarySort=this.value;renderLibraryGrid()">';
  html += '<option value="discovered"' + (librarySort === 'discovered' ? ' selected' : '') + '>Newest first</option>';
  html += '<option value="title"' + (librarySort === 'title' ? ' selected' : '') + '>Title A-Z</option>';
  html += '</select>';

  html += '<input id="lib-search" type="text" placeholder="Search titles..." value="' + escapeHtml(libraryFilters.search) + '" oninput="libraryFilters.search=this.value;renderLibraryGrid()">';
  html += '</div>';

  if (items.length === 0) {
    html += '<div class="empty">No items match your filters</div>';
  } else {
    html += '<div class="media-grid">';
    items.forEach(function(item) {
      var catColor = getCategoryColor(item.category);
      var coverHtml = item.cover_url
        ? '<img class="media-card-image" src="' + escapeHtml(item.cover_url) + '" alt="" onerror="this.style.display=\\'none\\';this.nextElementSibling.style.display=\\'flex\\'">'
          + '<div class="media-card-placeholder" style="display:none">' + getCategoryIcon(item.category) + '</div>'
        : '<div class="media-card-placeholder">' + getCategoryIcon(item.category) + '</div>';
      var ratingBadge = '';
      if (item.rating === 'up') ratingBadge = '<span class="rating-badge rating-up">👍</span>';
      else if (item.rating === 'down') ratingBadge = '<span class="rating-badge rating-down">👎</span>';

      html += '<div class="media-card" onclick="viewLibraryItem(\\'' + escapeHtml(item.id) + '\\')">';
      html += coverHtml;
      html += '<div class="media-card-body">';
      html += '<div class="media-card-title">' + escapeHtml(item.title || 'Untitled') + '</div>';
      html += '<div class="media-card-meta">';
      html += '<span class="category-badge" style="background:' + catColor + '20;color:' + catColor + '">' + escapeHtml(item.category || '') + '</span>';
      if (ratingBadge) html += ratingBadge;
      html += '</div>';
      html += '</div></div>';
    });
    html += '</div>';
  }

  html += '<div style="text-align:center;color:#999;font-size:12px;margin-top:12px">' + items.length + ' of ' + libraryItems.length + ' items</div>';
  document.getElementById('content').innerHTML = html;
}

async function viewLibraryItem(id) {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading...</div>';
  try {
    var res = await fetch('/api/library/' + encodeURIComponent(id));
    var item = await res.json();
    if (res.status !== 200) { contentEl.innerHTML = '<div class="empty">Item not found</div>'; return; }

    var hasVideo = item.metadata && item.metadata.video_id;
    var hasCover = item.metadata && item.metadata.cover_url;

    var html = '<div style="margin-bottom:12px"><button class="refresh-btn" onclick="renderLibraryGrid()">← Back to library</button></div>';
    // Video items use single-column layout; others use two-column with cover
    html += hasVideo ? '<div class="media-detail" style="grid-template-columns:1fr">' : '<div class="media-detail">';

    // Cover column (skip for video items — they get the embed inline instead)
    if (!hasVideo) {
      html += '<div class="media-detail-cover-col">';
      if (hasCover) {
        html += '<img class="media-detail-cover" src="' + escapeHtml(item.metadata.cover_url) + '" alt="">';
      } else {
        html += '<div class="media-card-placeholder" style="width:100%;max-width:300px;height:400px;font-size:64px">' + getCategoryIcon(item.category) + '</div>';
      }
      html += '</div>';
    }

    // Info column
    html += '<div class="media-detail-info">';
    html += '<h2 style="margin:0 0 8px">' + escapeHtml(item.title || 'Untitled') + '</h2>';

    // Metadata
    var meta = item.metadata || {};
    if (meta.author) html += '<div style="color:#666;margin-bottom:4px">by ' + escapeHtml(meta.author) + '</div>';
    if (meta.year) html += '<div style="color:#999;font-size:13px;margin-bottom:8px">' + meta.year + '</div>';
    if (meta.narrator) html += '<div style="color:#666;font-size:13px;margin-bottom:4px">Narrated by ' + escapeHtml(meta.narrator) + '</div>';
    if (meta.length) html += '<div style="color:#999;font-size:13px;margin-bottom:8px">' + escapeHtml(meta.length) + '</div>';

    // Category + format badges
    var catColor = getCategoryColor(item.category);
    html += '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">';
    html += '<span class="category-badge" style="background:' + catColor + '20;color:' + catColor + '">' + escapeHtml(item.category || '') + '</span>';
    if (item.format) html += '<span class="category-badge" style="background:#f5f5f5;color:#666">' + escapeHtml(item.format) + '</span>';
    if (item.status) html += '<span class="category-badge" style="background:#e8f5e9;color:#2e7d32">' + escapeHtml(item.status) + '</span>';
    html += '</div>';

    // Tags
    if (meta.tags && meta.tags.length) {
      html += '<div style="display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap">';
      meta.tags.forEach(function(t) { html += '<span style="font-size:11px;padding:2px 6px;border-radius:4px;background:#f0f0f0;color:#666">' + escapeHtml(t) + '</span>'; });
      html += '</div>';
    }

    // Description
    if (meta.description) html += '<p style="color:#444;line-height:1.5">' + escapeHtml(meta.description) + '</p>';

    // YouTube embed
    if (meta.video_id) {
      html += '<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/' + escapeHtml(meta.video_id) + '" frameborder="0" allowfullscreen></iframe></div>';
    }

    // Why recommended
    if (item.reasoning) {
      html += '<div style="background:#f5f5f5;border-radius:8px;padding:12px;margin:12px 0">';
      html += '<div style="font-weight:600;font-size:13px;color:#666;margin-bottom:4px">Why recommended</div>';
      html += '<div style="color:#444;font-size:14px">' + escapeHtml(item.reasoning) + '</div>';
      html += '</div>';
    }

    // Sources
    if (item.sources && item.sources.length) {
      html += '<div style="margin:12px 0"><div style="font-weight:600;font-size:13px;color:#666;margin-bottom:6px">Available from</div>';
      item.sources.forEach(function(s) {
        html += '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener" style="display:inline-block;margin:2px 4px 2px 0;padding:4px 10px;border-radius:4px;background:#e3f2fd;color:#1565c0;text-decoration:none;font-size:13px">' + escapeHtml(s.name) + '</a>';
      });
      html += '</div>';
    } else if (item.source_url) {
      html += '<a href="' + escapeHtml(item.source_url) + '" target="_blank" rel="noopener" style="display:inline-block;margin:12px 0;padding:6px 12px;border-radius:4px;background:#e3f2fd;color:#1565c0;text-decoration:none">Open source →</a>';
    }

    // Feedback section
    html += '<div class="library-feedback-panel">';
    html += '<div style="font-weight:600;font-size:13px;color:#666;margin-bottom:8px">Your feedback</div>';

    // Show existing feedback
    if (item.feedback) {
      var fb = item.feedback;
      html += '<div style="margin-bottom:8px;padding:8px;background:#f9f9f9;border-radius:4px">';
      if (fb.rating) html += '<span style="font-size:18px;margin-right:8px">' + (fb.rating === 'up' ? '👍' : '👎') + '</span>';
      if (fb.notes) html += '<span style="color:#444;font-size:13px">' + escapeHtml(typeof fb.notes === 'string' ? fb.notes : '') + '</span>';
      html += '</div>';
    }

    html += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    html += '<button class="refresh-btn" onclick="submitLibraryFeedback(\\'' + escapeHtml(id) + '\\', \\'up\\')" style="font-size:18px;padding:4px 12px">👍</button>';
    html += '<button class="refresh-btn" onclick="submitLibraryFeedback(\\'' + escapeHtml(id) + '\\', \\'down\\')" style="font-size:18px;padding:4px 12px">👎</button>';
    html += '</div>';
    html += '<textarea id="lib-feedback-notes" rows="3" placeholder="What did you like or dislike about this? Your text feedback is the most valuable signal." style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px;font-family:inherit;resize:vertical"></textarea>';
    html += '<button class="refresh-btn" onclick="submitLibraryFeedback(\\'' + escapeHtml(id) + '\\')" style="margin-top:6px">Submit feedback</button>';
    html += '</div>';

    html += '</div></div>';
    contentEl.innerHTML = html;
    contentEl.scrollTop = 0;
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load item: ' + escapeHtml(err.message) + '</div>';
  }
}

async function submitLibraryFeedback(id, rating) {
  var notes = document.getElementById('lib-feedback-notes');
  var notesText = notes ? notes.value.trim() : '';
  if (!rating && !notesText) { alert('Please provide a rating or notes'); return; }
  var body = {};
  if (rating) body.rating = rating;
  if (notesText) body.notes = notesText;
  try {
    var res = await fetch('/api/feedback/library/' + encodeURIComponent(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      // Refresh the detail view
      viewLibraryItem(id);
    }
  } catch {}
}

async function loadLibrary() {
  var contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading library...</div>';
  try {
    var res = await fetch('/api/library');
    libraryItems = await res.json();
    renderLibraryGrid();
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load library</div>';
  }
}
`;
}

module.exports = { getLibraryTabJS };
