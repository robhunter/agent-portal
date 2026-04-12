// tabs/todos.js — Todos tab client-side JS
// Renders a todo list with checkboxes and a notes thread

function getTodosTabJS() {
  return `
// --- Todos tab ---
async function loadTodos() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="empty">Loading todos...</div>';
  try {
    const res = await fetch('/api/todos');
    const data = await res.json();
    const todos = data.todos || [];
    const notes = data.notes || [];
    let html = '';

    // Open todos pinned at top
    const openTodos = todos.filter(function(t) { return !t.done; });
    const doneTodos = todos.filter(function(t) { return t.done; });

    html += '<div class="status-section"><h2>Todos</h2>';

    if (todos.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No todos yet. Add one below.</div>';
    } else {
      // Open todos first
      openTodos.forEach(function(t) {
        var idx = todos.indexOf(t);
        var hasDetails = t.details && t.details.trim();
        html += '<div class="todo-item">'
          + '<input type="checkbox" class="todo-cb" onchange="toggleTodo(' + idx + ', this.checked)">'
          + '<div class="todo-body" ' + (hasDetails ? 'onclick="toggleDetails(' + idx + ')"' : '') + '>'
          + '<span class="todo-text md-content">' + marked.parse(t.text).trim() + '</span>'
          + (hasDetails ? ' <span class="todo-info-badge" title="Has additional info">i</span>' : '')
          + '</div>'
          + '<button class="todo-edit" onclick="editTodoDetails(' + idx + ')" title="Edit details">\\u270e</button>'
          + '<button class="todo-delete" onclick="deleteTodo(' + idx + ')" title="Delete">\\u00d7</button>'
          + '</div>';
        if (hasDetails) {
          html += '<div class="todo-details md-content" id="todo-details-' + idx + '" style="display:none">'
            + marked.parse(t.details) + '</div>';
        }
      });

      // Completed todos — collapsible, starts collapsed, reverse order (newest first)
      if (doneTodos.length > 0) {
        var collapsed = localStorage.getItem('todosCompletedCollapsed') !== 'false';
        html += '<div class="todo-done-section">';
        html += '<div class="todo-done-header" onclick="toggleCompletedSection()" style="color:#999;font-size:12px;padding:8px 0;border-top:1px solid #eee;margin-top:8px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px">'
          + '<span class="todo-collapse-arrow" style="font-size:10px;transition:transform 0.2s;display:inline-block;transform:rotate(' + (collapsed ? '0' : '90') + 'deg)">\\u25b6</span>'
          + 'Completed (' + doneTodos.length + ')'
          + '</div>';
        html += '<div id="completed-todos" style="' + (collapsed ? 'display:none' : '') + '">';
        var reversedDone = doneTodos.slice().reverse();
        reversedDone.forEach(function(t) {
          var idx = todos.indexOf(t);
          var hasDetails = t.details && t.details.trim();
          html += '<div class="todo-item todo-completed">'
            + '<input type="checkbox" class="todo-cb" checked onchange="toggleTodo(' + idx + ', this.checked)">'
            + '<div class="todo-body" ' + (hasDetails ? 'onclick="toggleDetails(' + idx + ')"' : '') + '>'
            + '<span class="todo-text md-content">' + marked.parse(t.text).trim() + '</span>'
            + (hasDetails ? ' <span class="todo-info-badge" title="Has additional info">i</span>' : '')
            + '</div>'
            + '<button class="todo-delete" onclick="deleteTodo(' + idx + ')" title="Delete">\\u00d7</button>'
            + '</div>';
          if (hasDetails) {
            html += '<div class="todo-details md-content" id="todo-details-' + idx + '" style="display:none">'
              + marked.parse(t.details) + '</div>';
          }
        });
        html += '</div></div>';
      }
    }

    // Add todo form
    html += '<div class="todo-add-form" style="margin-top:12px;display:flex;gap:8px">'
      + '<input type="text" id="todo-input" placeholder="Add a todo..." '
      + 'style="flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px" '
      + 'onkeydown="if(event.key===\\'Enter\\')addTodo()">'
      + '<button onclick="addTodo()" style="padding:8px 16px;background:#1a73e8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px">Add</button>'
      + '</div>';

    html += '</div>';

    // Notes section — reverse chronological, first 5 visible, rest behind infinite scroll
    var reversedNotes = notes.slice().reverse();
    html += '<div class="status-section"><h2>Notes</h2>';
    if (reversedNotes.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No notes yet.</div>';
    } else {
      html += '<div class="journal-thread" id="notes-thread">';
      var initialCount = Math.min(5, reversedNotes.length);
      for (var i = 0; i < initialCount; i++) {
        var n = reversedNotes[i];
        html += '<div class="journal-entry author-' + escapeHtml(n.author) + '">'
          + '<div class="journal-entry-header">'
          + '<span class="author-badge ' + escapeHtml(n.author) + '">' + escapeHtml(n.author) + '</span>'
          + '<span class="tag-badge tag-' + escapeHtml(n.tag) + '">' + escapeHtml(n.tag) + '</span>'
          + '<span class="timestamp">' + formatTimestamp(n.ts) + '</span>'
          + '</div>'
          + '<div class="journal-entry-body md-content">' + marked.parse(n.content) + '</div>'
          + '</div>';
      }
      if (reversedNotes.length > 5) {
        html += '<div id="notes-load-sentinel" style="text-align:center;padding:12px;color:#999;font-size:13px">Scroll for older notes...</div>';
      }
      html += '</div>';
      // Store remaining notes for infinite scroll
      window._remainingNotes = reversedNotes.slice(5);
    }

    // Add note form
    html += '<div id="add-note" style="margin-top:12px">'
      + '<textarea id="todo-note-text" placeholder="Add a note about these todos..." style="width:100%;box-sizing:border-box"></textarea>'
      + '<div class="form-row">'
      + '<button onclick="addTodoNote()" id="todo-note-submit">Add Note</button>'
      + '</div>'
      + '</div>';

    html += '</div>';

    contentEl.innerHTML = html;
    contentEl.scrollTop = 0;

    // Set up infinite scroll for notes
    var sentinel = document.getElementById('notes-load-sentinel');
    if (sentinel && window._remainingNotes && window._remainingNotes.length > 0) {
      var batchSize = 5;
      var observer = new IntersectionObserver(function(entries) {
        if (!entries[0].isIntersecting) return;
        var thread = document.getElementById('notes-thread');
        if (!thread || !window._remainingNotes || window._remainingNotes.length === 0) {
          observer.disconnect();
          if (sentinel) sentinel.remove();
          return;
        }
        var batch = window._remainingNotes.splice(0, batchSize);
        var frag = '';
        batch.forEach(function(n) {
          frag += '<div class="journal-entry author-' + escapeHtml(n.author) + '">'
            + '<div class="journal-entry-header">'
            + '<span class="author-badge ' + escapeHtml(n.author) + '">' + escapeHtml(n.author) + '</span>'
            + '<span class="tag-badge tag-' + escapeHtml(n.tag) + '">' + escapeHtml(n.tag) + '</span>'
            + '<span class="timestamp">' + formatTimestamp(n.ts) + '</span>'
            + '</div>'
            + '<div class="journal-entry-body md-content">' + marked.parse(n.content) + '</div>'
            + '</div>';
        });
        sentinel.insertAdjacentHTML('beforebegin', frag);
        if (window._remainingNotes.length === 0) {
          observer.disconnect();
          sentinel.remove();
        }
      }, { rootMargin: '200px' });
      observer.observe(sentinel);
    }
  } catch (err) {
    contentEl.innerHTML = '<div class="empty">Failed to load todos</div>';
  }
}

async function addTodo() {
  var input = document.getElementById('todo-input');
  var text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  try {
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
  } catch {}
  await loadTodos();
}

async function toggleTodo(index, done) {
  try {
    await fetch('/api/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: index, done: done })
    });
  } catch {}
  await loadTodos();
}

async function deleteTodo(index) {
  try {
    await fetch('/api/todos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: index })
    });
  } catch {}
  await loadTodos();
}

function toggleDetails(idx) {
  var el = document.getElementById('todo-details-' + idx);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

function editTodoDetails(idx) {
  var overlay = document.createElement('div');
  overlay.className = 'todo-edit-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  var modal = document.createElement('div');
  modal.className = 'todo-edit-modal';
  modal.innerHTML = '<h3>Edit Details</h3>'
    + '<textarea id="edit-details-text" placeholder="Additional information (supports markdown, lists, code blocks...)" style="width:100%;min-height:120px;border:1px solid #ddd;border-radius:6px;padding:8px;font-family:inherit;font-size:14px;resize:vertical;box-sizing:border-box"></textarea>'
    + '<div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">'
    + '<button onclick="this.closest(\\'.todo-edit-overlay\\').remove()" style="padding:6px 16px;background:#fff;color:#555;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:13px">Cancel</button>'
    + '<button onclick="saveTodoDetails(' + idx + ')" style="padding:6px 16px;background:#1a73e8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Save</button>'
    + '</div>';
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Load current details
  fetch('/api/todos').then(function(r) { return r.json(); }).then(function(data) {
    var ta = document.getElementById('edit-details-text');
    if (ta && data.todos[idx]) ta.value = data.todos[idx].details || '';
    if (ta) ta.focus();
  });
}

async function saveTodoDetails(idx) {
  var ta = document.getElementById('edit-details-text');
  if (!ta) return;
  try {
    await fetch('/api/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: idx, details: ta.value })
    });
  } catch {}
  var overlay = ta.closest('.todo-edit-overlay');
  if (overlay) overlay.remove();
  await loadTodos();
}

function toggleCompletedSection() {
  var el = document.getElementById('completed-todos');
  var arrow = document.querySelector('.todo-collapse-arrow');
  if (el.style.display === 'none') {
    el.style.display = '';
    arrow.style.transform = 'rotate(90deg)';
    localStorage.setItem('todosCompletedCollapsed', 'false');
  } else {
    el.style.display = 'none';
    arrow.style.transform = 'rotate(0deg)';
    localStorage.setItem('todosCompletedCollapsed', 'true');
  }
}

async function addTodoNote() {
  var text = document.getElementById('todo-note-text').value.trim();
  if (!text) return;
  var btn = document.getElementById('todo-note-submit');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await fetch('/api/todos/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
  } catch {}
  await loadTodos();
}
`;
}

module.exports = { getTodosTabJS };
