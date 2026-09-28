#!/usr/bin/env node
// scripts/clear-done-todos.js — Remove checked todos from the ## Todos section of a todos file.
// Usage: clear-done-todos.js <path to human_todos.md>
// Uses the Todos tab's own parser, so a checked item goes with its continuation
// and detail lines, and other sections (a "## Done — archive", say) are left as they are.

const fs = require('fs');
const { parseTodos, serializeTodos } = require('../lib/routes/todos');

const file = process.argv[2];
if (!file) {
  console.error('Usage: clear-done-todos.js <path to human_todos.md>');
  process.exit(1);
}

const content = fs.readFileSync(file, 'utf-8');
const { todos, notes } = parseTodos(content);
const open = todos.filter(t => !t.done);
if (open.length === todos.length) process.exit(0);

fs.writeFileSync(file, serializeTodos(open, notes, content));
console.log(`Cleared ${todos.length - open.length} completed todos from ${file}`);
