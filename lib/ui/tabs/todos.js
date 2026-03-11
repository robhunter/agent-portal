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
        html += '<div class="todo-item">'
          + '<label class="todo-checkbox">'
          + '<input type="checkbox" onchange="toggleTodo(' + idx + ', this.checked)">'
          + '<span class="todo-text md-content">' + marked.parse(t.text).trim() + '</span>'
          + '</label>'
          + '<button class="todo-delete" onclick="deleteTodo(' + idx + ')" title="Delete">\\u00d7</button>'
          + '</div>';
      });

      // Done todos
      if (doneTodos.length > 0) {
        html += '<div class="todo-done-section">';
        html += '<div style="color:#999;font-size:12px;padding:8px 0;border-top:1px solid #eee;margin-top:8px">Completed</div>';
        doneTodos.forEach(function(t) {
          var idx = todos.indexOf(t);
          html += '<div class="todo-item todo-completed">'
            + '<label class="todo-checkbox">'
            + '<input type="checkbox" checked onchange="toggleTodo(' + idx + ', this.checked)">'
            + '<span class="todo-text md-content">' + marked.parse(t.text).trim() + '</span>'
            + '</label>'
            + '<button class="todo-delete" onclick="deleteTodo(' + idx + ')" title="Delete">\\u00d7</button>'
            + '</div>';
        });
        html += '</div>';
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

    // Notes section
    html += '<div class="status-section"><h2>Notes</h2>';
    if (notes.length === 0) {
      html += '<div style="color:#999;font-size:14px;padding:8px 0">No notes yet.</div>';
    } else {
      html += '<div class="journal-thread">';
      notes.forEach(function(n) {
        html += '<div class="journal-entry author-' + escapeHtml(n.author) + '">'
          + '<div class="journal-entry-header">'
          + '<span class="author-badge ' + escapeHtml(n.author) + '">' + escapeHtml(n.author) + '</span>'
          + '<span class="tag-badge tag-' + escapeHtml(n.tag) + '">' + escapeHtml(n.tag) + '</span>'
          + '<span class="timestamp">' + formatTimestamp(n.ts) + '</span>'
          + '</div>'
          + '<div class="journal-entry-body md-content">' + marked.parse(n.content) + '</div>'
          + '</div>';
      });
      html += '</div>';
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
