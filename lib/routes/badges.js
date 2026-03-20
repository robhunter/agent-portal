// routes/badges.js — Badge counts for nav tabs
// Returns unreviewed/pending/open counts for outputs, requests, todos

const fs = require('fs');
const path = require('path');
const { sendJSON } = require('../helpers');

function register(routes, config) {
  const agentDir = config.agentDir || '.';
  const tabs = (config.features && config.features.tabs) || [];

  routes['GET /api/badges'] = (req, res) => {
    const badges = {};

    // Outputs: count unreviewed
    if (tabs.includes('outputs') && config.features && config.features.outputs) {
      try {
        const outputDir = path.join(agentDir, 'output');
        const feedbackDir = path.join(agentDir, 'input', 'feedback');
        const processedDir = path.join(feedbackDir, 'processed');
        const files = fs.readdirSync(outputDir)
          .filter(f => f.endsWith('.md') && f !== '.gitkeep');
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
        const requestsDir = path.join(agentDir, 'requests');
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

    // Todos: count open (not done)
    if (tabs.includes('todos')) {
      try {
        const todosFile = path.join(agentDir, 'human_todos.md');
        const content = fs.readFileSync(todosFile, 'utf-8');
        const lines = content.split('\n');
        let open = 0;
        let inTodos = false;
        for (const line of lines) {
          if (/^## Todos/i.test(line)) { inTodos = true; continue; }
          if (/^## /i.test(line) && inTodos) break;
          if (inTodos) {
            const match = line.match(/^- \[([ ])\] /);
            if (match) open++;
          }
        }
        if (open > 0) badges.todos = open;
      } catch {}
    }

    sendJSON(res, 200, badges);
  };
}

module.exports = { register };
