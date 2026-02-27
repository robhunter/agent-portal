// ui.js — Re-exports buildHTML from the modular ui/ directory
// All consumers should use: const { buildHTML } = require('./ui') or require('../lib/ui')

const { buildHTML } = require('./ui/shell');

module.exports = { buildHTML };
