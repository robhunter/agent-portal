// routes/todos.js — Todos tab API endpoints
// Reads/writes human_todos.md in the agent directory
// Format: markdown with checkboxes and optional notes section

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody } = require('../helpers');

/**
 * Parse human_todos.md into structured data.
 * Format:
 *   ## Todos
 *   - [ ] Open todo text
 *   - [x] Completed todo text
 *   ## Notes
 *   ### <ISO timestamp> | <author> | note
 *   Note content...
 */
function parseTodos(content) {
  const todos = [];
  const notes = [];

  if (!content) return { todos, notes };

  const lines = content.split('\n');
  let section = null;
  let noteBuffer = null;

  for (const line of lines) {
    // Detect section headers
    if (/^## Todos/i.test(line)) { section = 'todos'; continue; }
    if (/^## Notes/i.test(line)) {
      if (noteBuffer) notes.push(noteBuffer);
      noteBuffer = null;
      section = 'notes';
      continue;
    }

    if (section === 'todos') {
      const match = line.match(/^- \[([ xX])\] (.+)$/);
      if (match) {
        todos.push({
          text: match[2].trim(),
          done: match[1] !== ' ',
          details: '',
        });
      } else if (todos.length > 0 && line.match(/^\s+> /) && !line.match(/^- \[/)) {
        // Details line (indented blockquote) — append to details
        todos[todos.length - 1].details += (todos[todos.length - 1].details ? '\n' : '') + line.replace(/^\s+> /, '');
      } else if (todos.length > 0 && line.match(/^\s+\S/) && !line.match(/^- \[/)) {
        // Continuation line (indented, not a new checkbox) — append to previous todo
        todos[todos.length - 1].text += '\n' + line.trimStart();
      }
    } else if (section === 'notes') {
      const headerMatch = line.match(/^### (\S+)\s*\|\s*(\w+)\s*\|\s*(\w+)/);
      if (headerMatch) {
        if (noteBuffer) notes.push(noteBuffer);
        noteBuffer = { ts: headerMatch[1], author: headerMatch[2], tag: headerMatch[3], content: '' };
      } else if (noteBuffer) {
        noteBuffer.content += (noteBuffer.content ? '\n' : '') + line;
      }
    }
  }
  if (noteBuffer) notes.push(noteBuffer);

  // Trim note content
  notes.forEach(n => { n.content = n.content.trim(); });

  return { todos, notes };
}

/**
 * Serialize todos and notes back to markdown.
 */
function serializeTodos(todos, notes) {
  let md = '## Todos\n\n';
  for (const t of todos) {
    const lines = t.text.split('\n');
    md += `- [${t.done ? 'x' : ' '}] ${lines[0]}\n`;
    for (let i = 1; i < lines.length; i++) {
      md += `  ${lines[i]}\n`;
    }
    if (t.details) {
      const detailLines = t.details.split('\n');
      for (const dl of detailLines) {
        md += `  > ${dl}\n`;
      }
    }
  }
  md += '\n## Notes\n\n';
  for (const n of notes) {
    md += `### ${n.ts} | ${n.author} | ${n.tag}\n\n${n.content}\n\n`;
  }
  return md;
}

function register(routes, config) {
  if (!config.features || !config.features.tabs || !config.features.tabs.includes('todos')) return;

  const agentDir = config.agentDir || '.';
  const todosFile = path.join(agentDir, 'human_todos.md');

  function readTodosFile() {
    try {
      return fs.readFileSync(todosFile, 'utf-8');
    } catch {
      return '';
    }
  }

  // GET /api/todos — return parsed todos and notes
  routes['GET /api/todos'] = (req, res) => {
    const content = readTodosFile();
    const { todos, notes } = parseTodos(content);
    sendJSON(res, 200, { todos, notes });
  };

  // POST /api/todos — add a new todo
  routes['POST /api/todos'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.text || !body.text.trim()) {
        return sendJSON(res, 400, { ok: false, error: 'Text required' });
      }

      const content = readTodosFile();
      const { todos, notes } = parseTodos(content);
      todos.push({ text: body.text.trim(), done: false, details: (body.details || '').trim() });
      fs.writeFileSync(todosFile, serializeTodos(todos, notes));
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message });
    }
  };

  // PUT /api/todos — update a todo (toggle done, edit text, reorder)
  routes['PUT /api/todos'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      const content = readTodosFile();
      const { todos, notes } = parseTodos(content);

      if (typeof body.index !== 'number' || body.index < 0 || body.index >= todos.length) {
        return sendJSON(res, 400, { ok: false, error: 'Invalid index' });
      }

      if (typeof body.done === 'boolean') {
        todos[body.index].done = body.done;
      }
      if (typeof body.text === 'string' && body.text.trim()) {
        todos[body.index].text = body.text.trim();
      }
      if (typeof body.details === 'string') {
        todos[body.index].details = body.details.trim();
      }

      fs.writeFileSync(todosFile, serializeTodos(todos, notes));
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message });
    }
  };

  // DELETE /api/todos — remove a todo by index
  routes['DELETE /api/todos'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      const content = readTodosFile();
      const { todos, notes } = parseTodos(content);

      if (typeof body.index !== 'number' || body.index < 0 || body.index >= todos.length) {
        return sendJSON(res, 400, { ok: false, error: 'Invalid index' });
      }

      todos.splice(body.index, 1);
      fs.writeFileSync(todosFile, serializeTodos(todos, notes));
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message });
    }
  };

  // POST /api/todos/note — add a note to the notes section
  routes['POST /api/todos/note'] = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.text || !body.text.trim()) {
        return sendJSON(res, 400, { ok: false, error: 'Text required' });
      }

      const content = readTodosFile();
      const { todos, notes } = parseTodos(content);
      notes.push({
        ts: new Date().toISOString(),
        author: body.author || 'rob',
        tag: 'note',
        content: body.text.trim(),
      });
      fs.writeFileSync(todosFile, serializeTodos(todos, notes));
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message });
    }
  };
}

module.exports = { register, parseTodos, serializeTodos };
