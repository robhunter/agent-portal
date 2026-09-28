// routes/todos.js — Todos tab API endpoints
// Reads/writes human_todos.md in the agent directory
// Format: markdown with checkboxes and optional notes section

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody, dataPath } = require('../helpers');

const SECTION_HEADING = /^## /;
const TODOS_HEADING = /^## Todos/i;
const NOTES_HEADING = /^## Notes/i;
const TODO_LINE = /^- \[([ xX])\] (.+)$/;
const NOTE_HEADER = /^### (\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*$/;
const EMPTY_FILE = '## Todos\n\n## Notes\n';

// Each parsed todo and note remembers the lines it was read from, so a write
// can put back untouched items byte for byte. The property is a non-enumerable
// symbol: it never reaches JSON responses or deepEqual comparisons.
const ORIGIN = Symbol('origin');

const isBlank = (line) => line.trim() === '';

/**
 * Split a document at every `## ` heading. The first `## Todos` section and the
 * first `## Notes` section are the portal's; everything else (text before the
 * first heading, custom sections such as `## Parked`, a repeated Todos or Notes
 * heading) is carried through every write verbatim and never parsed.
 */
function splitSections(content) {
  const sections = [{ kind: 'preamble', lines: [] }];
  for (const line of content.split('\n')) {
    if (SECTION_HEADING.test(line)) {
      let kind = 'other';
      if (TODOS_HEADING.test(line) && !sections.some(s => s.kind === 'todos')) kind = 'todos';
      else if (NOTES_HEADING.test(line) && !sections.some(s => s.kind === 'notes')) kind = 'notes';
      sections.push({ kind, lines: [line] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }
  return sections;
}

/**
 * Split a section body into the lines before its first block, its blocks, and
 * the blank lines that end it. A block starts at a line matching `startsBlock`
 * and runs to the next such line.
 */
function splitBlocks(body, startsBlock) {
  let end = body.length;
  while (end > 0 && isBlank(body[end - 1])) end--;
  const intro = [];
  const blocks = [];
  for (const line of body.slice(0, end)) {
    if (startsBlock.test(line)) blocks.push([line]);
    else if (blocks.length) blocks[blocks.length - 1].push(line);
    else intro.push(line);
  }
  return { intro, blocks, tail: body.slice(end) };
}

/**
 * A todo block is its checkbox line plus the lines after it: indented `> `
 * lines are details, other indented lines continue the text, and blank or
 * unindented lines are kept for the write but not parsed.
 */
function todoFromBlock(lines) {
  const match = lines[0].match(TODO_LINE);
  const todo = { text: match[2].trim(), done: match[1] !== ' ', details: '' };
  for (const line of lines.slice(1)) {
    if (/^\s+> /.test(line)) {
      todo.details += (todo.details ? '\n' : '') + line.replace(/^\s+> /, '');
    } else if (/^\s+\S/.test(line)) {
      todo.text += '\n' + line.trimStart();
    }
  }
  Object.defineProperty(todo, ORIGIN, { value: { lines, text: todo.text, done: todo.done, details: todo.details } });
  return todo;
}

function noteFromBlock(lines) {
  const match = lines[0].match(NOTE_HEADER);
  const note = { ts: match[1], author: match[2], tag: match[3], content: lines.slice(1).join('\n').trim() };
  Object.defineProperty(note, ORIGIN, { value: { lines, ...note } });
  return note;
}

function readTodosSection(section) {
  const { intro, blocks, tail } = splitBlocks(section.lines.slice(1), TODO_LINE);
  return { intro, items: blocks.map(todoFromBlock), tail };
}

function readNotesSection(section) {
  const { intro, blocks, tail } = splitBlocks(section.lines.slice(1), NOTE_HEADER);
  return { intro, items: blocks.map(noteFromBlock), tail };
}

/**
 * Parse human_todos.md into structured data.
 * Format:
 *   ## Todos
 *   - [ ] Open todo text
 *   - [x] Completed todo text
 *   ## Notes
 *   ### <ISO timestamp> | <author> | note
 *   Note content...
 *
 * Todos are the checkboxes under the first `## Todos` heading, up to the next
 * `## ` heading of any kind; notes likewise under the first `## Notes`. The
 * badge count and every write use this same parse, so a todo's index in the
 * returned array is the index PUT and DELETE resolve.
 */
function parseTodos(content) {
  if (!content) return { todos: [], notes: [] };
  const sections = splitSections(content);
  const todosSection = sections.find(s => s.kind === 'todos');
  const notesSection = sections.find(s => s.kind === 'notes');
  return {
    todos: todosSection ? readTodosSection(todosSection).items : [],
    notes: notesSection ? readNotesSection(notesSection).items : [],
  };
}

function renderTodo(todo) {
  const textLines = todo.text.split('\n');
  const lines = [`- [${todo.done ? 'x' : ' '}] ${textLines[0]}`];
  for (let i = 1; i < textLines.length; i++) lines.push(`  ${textLines[i]}`);
  if (todo.details) {
    for (const detail of todo.details.split('\n')) lines.push(`  > ${detail}`);
  }
  return lines;
}

function todoLines(todo) {
  const origin = todo[ORIGIN];
  if (!origin) return renderTodo(todo);
  const sameWords = todo.text === origin.text && (todo.details || '') === origin.details;
  if (sameWords && todo.done === origin.done) return origin.lines;
  if (sameWords) {
    return [origin.lines[0].replace(/^- \[[ xX]\]/, `- [${todo.done ? 'x' : ' '}]`), ...origin.lines.slice(1)];
  }
  return [...renderTodo(todo), ...origin.lines.slice(1).filter(line => !/^\s+\S/.test(line))];
}

function renderNote(note) {
  return [`### ${note.ts} | ${note.author} | ${note.tag}`, '', ...note.content.split('\n')];
}

function noteLines(note) {
  const origin = note[ORIGIN];
  const unchanged = origin && ['ts', 'author', 'tag', 'content'].every(key => note[key] === origin[key]);
  return unchanged ? origin.lines : renderNote(note);
}

/**
 * Re-render one owned section around its new items. Its heading, the lines
 * before its first item and the blank lines ending it stay as they were; a
 * section that gains its first item gets one blank line under the heading.
 */
function renderSection(section, read, items, linesOf, separate) {
  const { intro, items: before, tail } = read(section);
  let head = intro;
  if (head.every(isBlank)) head = items.length ? (before.length ? intro : ['']) : [];
  const body = [];
  for (const item of items) {
    if (separate && body.length && !isBlank(body[body.length - 1])) body.push('');
    body.push(...linesOf(item));
  }
  return [section.lines[0], ...head, ...body, ...tail];
}

/**
 * Serialize todos and notes back to markdown. Pass the file content they were
 * parsed from as `original`: only its Todos and Notes sections are rewritten,
 * every other line comes back unchanged, and so do todos and notes the caller
 * did not modify. Without `original`, a new file is written.
 */
function serializeTodos(todos, notes, original = '') {
  const sections = splitSections(original.trim() ? original : EMPTY_FILE);
  let todosSection = sections.find(s => s.kind === 'todos');
  if (!todosSection && todos.length) {
    todosSection = { kind: 'todos', lines: ['## Todos', ''] };
    sections.splice(1, 0, todosSection);
  }
  let notesSection = sections.find(s => s.kind === 'notes');
  if (!notesSection && notes.length) {
    const last = sections[sections.length - 1].lines;
    if (last.length && !isBlank(last[last.length - 1])) last.push('');
    notesSection = { kind: 'notes', lines: ['## Notes', ''] };
    sections.push(notesSection);
  }
  const lines = [];
  for (const section of sections) {
    if (section === todosSection) lines.push(...renderSection(section, readTodosSection, todos, todoLines, false));
    else if (section === notesSection) lines.push(...renderSection(section, readNotesSection, notes, noteLines, true));
    else lines.push(...section.lines);
  }
  return lines.join('\n');
}

function register(routes, config) {
  if (!config.features || !config.features.tabs || !config.features.tabs.includes('todos')) return;

  const todosFile = dataPath(config, 'human_todos.md');

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
      fs.writeFileSync(todosFile, serializeTodos(todos, notes, content));
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

      fs.writeFileSync(todosFile, serializeTodos(todos, notes, content));
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
      fs.writeFileSync(todosFile, serializeTodos(todos, notes, content));
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
      fs.writeFileSync(todosFile, serializeTodos(todos, notes, content));
      sendJSON(res, 200, { ok: true });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message });
    }
  };
}

module.exports = { register, parseTodos, serializeTodos };
