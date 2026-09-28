const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');
const { parseTodos, serializeTodos } = require('../lib/routes/todos');

// --- Unit tests for parseTodos / serializeTodos ---

describe('parseTodos', () => {
  it('parses empty content', () => {
    const { todos, notes } = parseTodos('');
    assert.deepEqual(todos, []);
    assert.deepEqual(notes, []);
  });

  it('parses open and done todos', () => {
    const content = `## Todos

- [ ] Buy milk
- [x] Write tests
- [ ] Deploy

## Notes
`;
    const { todos } = parseTodos(content);
    assert.equal(todos.length, 3);
    assert.deepEqual(todos[0], { text: 'Buy milk', done: false, details: '' });
    assert.deepEqual(todos[1], { text: 'Write tests', done: true, details: '' });
    assert.deepEqual(todos[2], { text: 'Deploy', done: false, details: '' });
  });

  it('parses notes section', () => {
    const content = `## Todos

- [ ] Something

## Notes

### 2026-03-09T10:00:00Z | rob | note

This is a note.

### 2026-03-09T11:00:00Z | coder | note

Agent response.
`;
    const { notes } = parseTodos(content);
    assert.equal(notes.length, 2);
    assert.equal(notes[0].author, 'rob');
    assert.equal(notes[0].content, 'This is a note.');
    assert.equal(notes[1].author, 'coder');
    assert.equal(notes[1].content, 'Agent response.');
  });
  it('parses multi-line todos with indented continuation', () => {
    const content = `## Todos

- [ ] First todo
  with more detail
  and another line
- [x] Simple done
- [ ] Third todo
  continued here

## Notes
`;
    const { todos } = parseTodos(content);
    assert.equal(todos.length, 3);
    assert.equal(todos[0].text, 'First todo\nwith more detail\nand another line');
    assert.equal(todos[0].done, false);
    assert.equal(todos[1].text, 'Simple done');
    assert.equal(todos[1].done, true);
    assert.equal(todos[2].text, 'Third todo\ncontinued here');
  });

  it('round-trips multi-line todos', () => {
    const todos = [
      { text: 'Multi line\nwith detail', done: false },
      { text: 'Simple', done: true },
    ];
    const md = serializeTodos(todos, []);
    assert.ok(md.includes('- [ ] Multi line\n  with detail'));
    const parsed = parseTodos(md);
    assert.equal(parsed.todos[0].text, 'Multi line\nwith detail');
    assert.equal(parsed.todos[1].text, 'Simple');
  });
  it('parses todos with details (blockquote lines)', () => {
    const content = `## Todos

- [ ] Email mcpserverfinder.com
  > Copy the following text:
  > Hello, we would like to list agentdeals.
  > - bullet one
  > - bullet two
- [ ] Simple todo

## Notes
`;
    const { todos } = parseTodos(content);
    assert.equal(todos.length, 2);
    assert.equal(todos[0].text, 'Email mcpserverfinder.com');
    assert.equal(todos[0].details, 'Copy the following text:\nHello, we would like to list agentdeals.\n- bullet one\n- bullet two');
    assert.equal(todos[1].text, 'Simple todo');
    assert.equal(todos[1].details, '');
  });

  it('round-trips todos with details', () => {
    const todos = [
      { text: 'Todo with info', done: false, details: 'Line 1\nLine 2\n- bullet' },
      { text: 'No info', done: true, details: '' },
    ];
    const md = serializeTodos(todos, []);
    assert.ok(md.includes('  > Line 1'));
    assert.ok(md.includes('  > Line 2'));
    assert.ok(md.includes('  > - bullet'));
    const parsed = parseTodos(md);
    assert.equal(parsed.todos[0].details, 'Line 1\nLine 2\n- bullet');
    assert.equal(parsed.todos[1].details, '');
  });

  it('parses todos with both continuation text and details', () => {
    const content = `## Todos

- [ ] Multi line todo
  continued here
  > Detail info
  > More detail

## Notes
`;
    const { todos } = parseTodos(content);
    assert.equal(todos[0].text, 'Multi line todo\ncontinued here');
    assert.equal(todos[0].details, 'Detail info\nMore detail');
  });
});

describe('serializeTodos', () => {
  it('round-trips todos and notes', () => {
    const todos = [
      { text: 'Open task', done: false },
      { text: 'Done task', done: true },
    ];
    const notes = [
      { ts: '2026-03-09T10:00:00Z', author: 'rob', tag: 'note', content: 'Hello' },
    ];
    const md = serializeTodos(todos, notes);
    assert.ok(md.includes('- [ ] Open task'));
    assert.ok(md.includes('- [x] Done task'));
    assert.ok(md.includes('### 2026-03-09T10:00:00Z | rob | note'));
    assert.ok(md.includes('Hello'));

    // Round-trip
    const parsed = parseTodos(md);
    assert.equal(parsed.todos.length, 2);
    assert.equal(parsed.notes.length, 1);
  });
});

// --- Integration tests for API endpoints ---

function createTodosTestServer(agentDir) {
  const config = {
    name: 'Test',
    port: 0,
    agentDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-portal-lock-nonexistent',
    _serverStartTime: Date.now(),
    authors: { rob: { color: '#1565c0', bg: '#e3f2fd' } },
    features: { tabs: ['journal', 'status', 'todos'] },
  };

  const routes = {};
  require('../lib/routes/todos').register(routes, config);

  return { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }), config };
}

async function fetchJSON(port, urlPath, options = {}) {
  const res = await fetch(`http://localhost:${port}${urlPath}`, options);
  const data = await res.json();
  return { status: res.status, data };
}

describe('Todos API', () => {
  let server, port, tmpDir, todosFile;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todos-test-'));
    todosFile = path.join(tmpDir, 'human_todos.md');
    const result = createTodosTestServer(tmpDir);
    server = result.server;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset todos file
    try { fs.unlinkSync(todosFile); } catch {}
  });

  it('GET /api/todos returns empty when no file', async () => {
    const { status, data } = await fetchJSON(port, '/api/todos');
    assert.equal(status, 200);
    assert.deepEqual(data.todos, []);
    assert.deepEqual(data.notes, []);
  });

  it('POST /api/todos adds a todo', async () => {
    await fetchJSON(port, '/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test todo' }),
    });

    const { data } = await fetchJSON(port, '/api/todos');
    assert.equal(data.todos.length, 1);
    assert.equal(data.todos[0].text, 'Test todo');
    assert.equal(data.todos[0].done, false);
  });

  it('PUT /api/todos toggles done', async () => {
    // Add a todo first
    await fetchJSON(port, '/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Toggle me' }),
    });

    // Toggle it
    await fetchJSON(port, '/api/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 0, done: true }),
    });

    const { data } = await fetchJSON(port, '/api/todos');
    assert.equal(data.todos[0].done, true);
  });

  it('DELETE /api/todos removes a todo', async () => {
    // Add two todos
    await fetchJSON(port, '/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'First' }),
    });
    await fetchJSON(port, '/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Second' }),
    });

    // Delete first
    await fetchJSON(port, '/api/todos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 0 }),
    });

    const { data } = await fetchJSON(port, '/api/todos');
    assert.equal(data.todos.length, 1);
    assert.equal(data.todos[0].text, 'Second');
  });

  it('POST /api/todos/note adds a note', async () => {
    await fetchJSON(port, '/api/todos/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'A note about todos', author: 'rob' }),
    });

    const { data } = await fetchJSON(port, '/api/todos');
    assert.equal(data.notes.length, 1);
    assert.equal(data.notes[0].content, 'A note about todos');
    assert.equal(data.notes[0].author, 'rob');
  });

  it('rejects empty text on POST', async () => {
    const { status, data } = await fetchJSON(port, '/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '  ' }),
    });
    assert.equal(status, 400);
    assert.equal(data.ok, false);
  });

  it('rejects invalid index on PUT', async () => {
    const { status, data } = await fetchJSON(port, '/api/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 99, done: true }),
    });
    assert.equal(status, 400);
  });

  it('POST /api/todos with details', async () => {
    await fetchJSON(port, '/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'With details', details: 'Extra info here' }),
    });

    const { data } = await fetchJSON(port, '/api/todos');
    assert.equal(data.todos[0].text, 'With details');
    assert.equal(data.todos[0].details, 'Extra info here');
  });

  it('PUT /api/todos updates details', async () => {
    await fetchJSON(port, '/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Update me' }),
    });

    await fetchJSON(port, '/api/todos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: 0, details: 'New details\n- with bullets' }),
    });

    const { data } = await fetchJSON(port, '/api/todos');
    assert.equal(data.todos[0].details, 'New details\n- with bullets');
  });

  it('does not register routes when todos not in tabs', () => {
    const routes = {};
    const config = { features: { tabs: ['journal', 'status'] } };
    require('../lib/routes/todos').register(routes, config);
    assert.equal(Object.keys(routes).length, 0);
  });
});

// --- Files with sections the portal does not own ---

const SECTIONED = `## Todos

- [ ] Reply to the partner email
  > Done when: sent
- [x] Renew the domain
  with the two-year option
- [ ] Review the pricing page
- [X] Rotate the API key

## Parked — real, but not pressing

- [ ] Try the new analytics tool
- [ ] Draft the launch post

Parked until the launch date is set.

## Done — archive

- [x] Set up the status page
- [x] Move DNS to the new provider
  > Checked on 2026-08-01

## Notes

### 2026-08-20T10:00:00Z | rob | note

Please keep the archive.

### 2026-08-21T09:00:00Z | pm | note

Will do.

## Reference — logo and banner URLs

- logo: https://example.com/logo.png
- banner: https://example.com/banner.png
`;

const SHAPES = {
  sectioned: SECTIONED,
  notesFirst: '# Human todos\n\n## Notes\n\n### 2026-08-20T10:00:00Z | rob | note\n\nHi.\n\n## Todos\n\n- [ ] One\n- [ ] Two\n',
  repeatedTodosHeading: '## Todos\n\n- [ ] Mine\n\n## Todos\n\n- [ ] Pasted twice\n',
  checkboxesBeforeAnyHeading: '- [ ] Loose item\n\n## Todos\n- [ ] Owned\n## Later\n- [ ] Not owned',
  onlyCustomSections: '## Backlog\n\n- [ ] Someday\n',
  empty: '',
};

function firstLine(todo) {
  return todo.text.split('\n')[0];
}

function createTodosAndBadgesServer(agentDir) {
  const config = {
    name: 'Test',
    port: 0,
    agentDir,
    _serverStartTime: Date.now(),
    authors: {},
    features: { tabs: ['journal', 'status', 'todos'] },
  };
  const routes = {};
  require('../lib/routes/todos').register(routes, config);
  require('../lib/routes/badges').register(routes, config);
  return createServer(config, { routes, getHTML: () => '<html>test</html>' });
}

function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { removed: a.slice(start, endA), added: b.slice(start, endB) };
}

describe('parseTodos with sections it does not own', () => {
  it('lists only the checkboxes under ## Todos, up to the next ## heading of any kind', () => {
    const { todos } = parseTodos(SECTIONED);
    assert.deepEqual(todos.map(firstLine), [
      'Reply to the partner email',
      'Renew the domain',
      'Review the pricing page',
      'Rotate the API key',
    ]);
    assert.deepEqual(todos.map(t => t.done), [false, true, false, true]);
    assert.equal(todos[0].details, 'Done when: sent');
    assert.equal(todos[1].text, 'Renew the domain\nwith the two-year option');
  });

  it('ends the notes at the next ## heading, so a section after Notes is not read into the last note', () => {
    const { notes } = parseTodos(SECTIONED);
    assert.deepEqual(notes.map(n => n.content), ['Please keep the archive.', 'Will do.']);
  });

  it('owns only the first ## Todos section and reads it wherever it sits', () => {
    assert.deepEqual(parseTodos(SHAPES.notesFirst).todos.map(firstLine), ['One', 'Two']);
    assert.deepEqual(parseTodos(SHAPES.repeatedTodosHeading).todos.map(firstLine), ['Mine']);
    assert.deepEqual(parseTodos(SHAPES.checkboxesBeforeAnyHeading).todos.map(firstLine), ['Owned']);
    assert.deepEqual(parseTodos(SHAPES.onlyCustomSections).todos, []);
  });

  it('writes every shape back byte for byte when nothing changed', () => {
    for (const [shape, content] of Object.entries(SHAPES)) {
      if (!content) continue;
      const { todos, notes } = parseTodos(content);
      assert.equal(serializeTodos(todos, notes, content), content, shape);
    }
  });

  it('adds a ## Todos section after the text above the first heading when the file has none', () => {
    const content = '# Human todos\n\n## Backlog\n\n- [ ] Someday\n';
    const { todos, notes } = parseTodos(content);
    todos.push({ text: 'New', done: false, details: '' });
    assert.equal(serializeTodos(todos, notes, content), '# Human todos\n\n## Todos\n\n- [ ] New\n\n## Backlog\n\n- [ ] Someday\n');
  });
});

describe('Todos API on a file with sections it does not own', () => {
  let server, port, tmpDir, todosFile;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todos-sections-'));
    todosFile = path.join(tmpDir, 'human_todos.md');
    server = createTodosAndBadgesServer(tmpDir);
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function send(method, urlPath, body) {
    return fetchJSON(port, urlPath, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // These tests write the file directly, as an agent does, which the API's
  // 10-second GET cache cannot see; a new query string per read skips it.
  let reads = 0;
  async function listTodos() {
    return (await fetchJSON(port, `/api/todos?read=${reads++}`)).data.todos;
  }

  it('gives the badge and the tab the same open count for every shape', async () => {
    for (const [shape, content] of Object.entries(SHAPES)) {
      fs.writeFileSync(todosFile, content);
      const badges = (await fetchJSON(port, '/api/badges')).data;
      const listed = await listTodos();
      assert.equal(badges.todos || 0, listed.filter(t => !t.done).length, shape);
    }
    fs.writeFileSync(todosFile, SECTIONED);
    assert.equal((await fetchJSON(port, '/api/badges')).data.todos, 2);
  });

  it('keeps done items from other sections out of the list the Completed group is built from', async () => {
    fs.writeFileSync(todosFile, SECTIONED);
    const todos = await listTodos();
    assert.deepEqual(todos.filter(t => t.done).map(firstLine), ['Renew the domain', 'Rotate the API key']);
  });

  it('toggling a todo changes only its checkbox', async () => {
    fs.writeFileSync(todosFile, SECTIONED);
    const todos = await listTodos();
    await send('PUT', '/api/todos', { index: todos.findIndex(t => t.text === 'Review the pricing page'), done: true });
    assert.deepEqual(lineDiff(SECTIONED, fs.readFileSync(todosFile, 'utf-8')), {
      removed: ['- [ ] Review the pricing page'],
      added: ['- [x] Review the pricing page'],
    });
  });

  it('adding a todo inserts one line after the last todo', async () => {
    fs.writeFileSync(todosFile, SECTIONED);
    await send('POST', '/api/todos', { text: 'Call the bank' });
    const after = fs.readFileSync(todosFile, 'utf-8');
    assert.equal(after, SECTIONED.replace('- [X] Rotate the API key\n', '- [X] Rotate the API key\n- [ ] Call the bank\n'));
  });

  it('deleting a todo removes its lines and nothing else', async () => {
    fs.writeFileSync(todosFile, SECTIONED);
    const todos = await listTodos();
    await send('DELETE', '/api/todos', { index: todos.findIndex(t => firstLine(t) === 'Renew the domain') });
    assert.equal(fs.readFileSync(todosFile, 'utf-8'), SECTIONED.replace('- [x] Renew the domain\n  with the two-year option\n', ''));
  });

  it('adding a note appends it to ## Notes and leaves the section after it alone', async () => {
    fs.writeFileSync(todosFile, SECTIONED);
    await send('POST', '/api/todos/note', { text: 'Keep the parked list too.', author: 'rob' });
    const after = fs.readFileSync(todosFile, 'utf-8');
    const note = /\n\n### \S+ \| rob \| note\n\nKeep the parked list too\.(?=\n\n## Reference)/;
    assert.match(after, note);
    assert.equal(after.replace(note, ''), SECTIONED);
  });

  it('every index the tab can send resolves to the todo shown at that index', async () => {
    fs.writeFileSync(todosFile, SECTIONED);
    const todos = await listTodos();
    for (let index = 0; index < todos.length; index++) {
      fs.writeFileSync(todosFile, SECTIONED);
      await send('PUT', '/api/todos', { index, done: !todos[index].done });
      const { removed, added } = lineDiff(SECTIONED, fs.readFileSync(todosFile, 'utf-8'));
      assert.equal(removed.length, 1, `index ${index}`);
      assert.ok(removed[0].endsWith(firstLine(todos[index])), `index ${index} toggled ${removed[0]}`);
      assert.equal(added[0].slice(6), removed[0].slice(6), `index ${index}`);

      fs.writeFileSync(todosFile, SECTIONED);
      await send('DELETE', '/api/todos', { index });
      const deleted = lineDiff(SECTIONED, fs.readFileSync(todosFile, 'utf-8'));
      assert.deepEqual(deleted.added, [], `index ${index}`);
      assert.ok(deleted.removed[0].endsWith(firstLine(todos[index])), `index ${index} deleted ${deleted.removed[0]}`);
    }
  });
});

// --- Test clear-done-todos.sh script ---
describe('clear-done-todos.sh', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todos-clear-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes checked todos', async () => {
    const todosFile = path.join(tmpDir, 'human_todos.md');
    fs.writeFileSync(todosFile, `## Todos

- [ ] Keep this
- [x] Remove this
- [ ] Keep this too
- [X] Also remove

## Notes

### 2026-03-09T10:00:00Z | rob | note

Keep this note.
`);

    const { execSync } = require('child_process');
    const scriptPath = path.resolve(__dirname, '..', 'scripts', 'clear-done-todos.sh');
    execSync(`bash "${scriptPath}" "${tmpDir}"`);

    const content = fs.readFileSync(todosFile, 'utf-8');
    assert.ok(content.includes('- [ ] Keep this'));
    assert.ok(content.includes('- [ ] Keep this too'));
    assert.ok(!content.includes('Remove this'));
    assert.ok(!content.includes('Also remove'));
    assert.ok(content.includes('Keep this note'));
  });

  it('clears checked todos under ## Todos with their continuation lines, and leaves other sections alone', () => {
    const todosFile = path.join(tmpDir, 'human_todos.md');
    fs.writeFileSync(todosFile, SECTIONED);

    const { execSync } = require('child_process');
    const scriptPath = path.resolve(__dirname, '..', 'scripts', 'clear-done-todos.sh');
    execSync(`bash "${scriptPath}" "${tmpDir}"`);

    assert.equal(
      fs.readFileSync(todosFile, 'utf-8'),
      SECTIONED.replace('- [x] Renew the domain\n  with the two-year option\n', '').replace('- [X] Rotate the API key\n', ''),
    );
  });
});
