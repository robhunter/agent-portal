// routes/badges.js — Badge counts for nav tabs
// Returns unreviewed/pending/open counts for outputs, requests, todos

const fs = require('fs');
const path = require('path');
const { sendJSON, dataPath } = require('../helpers');
const { parseTodos } = require('./todos');

function register(routes, config) {
  const agentDir = config.agentDir || '.';
  const tabs = (config.features && config.features.tabs) || [];

  routes['GET /api/badges'] = (req, res) => {
    const badges = {};
    const parsed = new URL(req.url, 'http://localhost');
    const projectSlug = parsed.searchParams.get('project') || null;

    // Outputs: count unreviewed
    if (tabs.includes('outputs') && config.features && config.features.outputs) {
      try {
        const outputDir = dataPath(config, 'output');
        const feedbackDir = dataPath(config, 'input', 'feedback');
        const processedDir = path.join(feedbackDir, 'processed');
        let files = fs.readdirSync(outputDir)
          .filter(f => f.endsWith('.md') && f !== '.gitkeep');
        if (projectSlug) {
          files = files.filter(f => f.startsWith(projectSlug));
        }
        let unreviewed = 0;
        for (const f of files) {
          const feedbackFile = f.replace('.md', '.feedback.yaml');
          const hasFeedback = fs.existsSync(path.join(feedbackDir, feedbackFile))
            || fs.existsSync(path.join(processedDir, feedbackFile));
          if (!hasFeedback) unreviewed++;
        }
        if (unreviewed > 0) badges.outputs = unreviewed;
      } catch {}
    }

    // Requests: count pending
    if (tabs.includes('requests') && config.features && config.features.requests) {
      try {
        const requestsDir = dataPath(config, 'requests');
        const files = fs.readdirSync(requestsDir)
          .filter(f => f.endsWith('.md') && f !== '_template.md');
        let pending = 0;
        for (const file of files) {
          const content = fs.readFileSync(path.join(requestsDir, file), 'utf-8');
          const statusMatch = content.match(/\*\*Status:\*\*\s*(\w+)/);
          if (statusMatch && statusMatch[1].toLowerCase() === 'pending') pending++;
        }
        if (pending > 0) badges.requests = pending;
      } catch {}
    }

    // Library: count unrated items (opt-out via features.library.badges: false)
    const libraryConf = config.features && config.features.library;
    const libraryBadges = typeof libraryConf === 'object' ? libraryConf.badges !== false : !!libraryConf;
    if (tabs.includes('library') && libraryConf && libraryBadges) {
      try {
        const libraryDataDir = (typeof config.features.library === 'object' && config.features.library.dataDir) || 'content/items';
        const itemsDir = dataPath(config, libraryDataDir);
        const feedbackDir = dataPath(config, 'input', 'feedback');
        const files = fs.readdirSync(itemsDir)
          .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        const processedDir = path.join(feedbackDir, 'processed');
        let unrated = 0;
        for (const f of files) {
          const id = f.replace(/\.ya?ml$/, '');
          const feedbackFile = id + '.feedback.yaml';
          if (!fs.existsSync(path.join(feedbackDir, feedbackFile))
              && !fs.existsSync(path.join(processedDir, feedbackFile))) unrated++;
        }
        if (unrated > 0) badges.library = unrated;
      } catch {}
    }

    // Todos: count open (not done), with the parser the Todos tab lists them by
    if (tabs.includes('todos')) {
      try {
        const todosFile = dataPath(config, 'human_todos.md');
        const { todos } = parseTodos(fs.readFileSync(todosFile, 'utf-8'));
        const open = todos.filter(t => !t.done).length;
        if (open > 0) badges.todos = open;
      } catch {}
    }

    sendJSON(res, 200, badges);
  };
}

module.exports = { register };
