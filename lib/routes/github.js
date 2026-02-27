// routes/github.js — /api/github/issues, /api/github/prs
// Supports 0, 1, or N repos via config.features.github.repos array
// Uses `gh` CLI with 60-second response cache

const { execSync } = require('child_process');
const { sendJSON } = require('../helpers');

// Simple in-memory cache with 60s TTL
const cache = {};
function cachedExec(key, cmd) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].ts) < 60000) {
    return cache[key].data;
  }
  try {
    const raw = execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
    const data = JSON.parse(raw);
    cache[key] = { ts: now, data };
    return data;
  } catch (e) {
    return { _error: e.message, items: [] };
  }
}

function register(routes, config) {
  const github = config.features && config.features.github;
  if (!github || !Array.isArray(github.repos) || github.repos.length === 0) {
    // No GitHub repos configured — register stub routes that return empty data
    routes['GET /api/github/issues'] = (req, res) => {
      sendJSON(res, 200, { items: [], repos: [] });
    };
    routes['GET /api/github/prs'] = (req, res) => {
      sendJSON(res, 200, { items: [], repos: [] });
    };
    return;
  }

  const repos = github.repos;

  routes['GET /api/github/issues'] = (req, res) => {
    const allItems = [];
    const errors = [];
    for (const repo of repos) {
      const result = cachedExec(
        `issues:${repo}`,
        `gh issue list --repo ${repo} --state open --json number,title,labels,createdAt,updatedAt,url --limit 50`
      );
      if (result._error) {
        errors.push({ repo, error: result._error });
      } else if (Array.isArray(result)) {
        for (const item of result) {
          item.repo = repo;
          allItems.push(item);
        }
      }
    }
    // Sort by createdAt descending (newest first)
    allItems.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const response = { items: allItems, repos };
    if (errors.length > 0) response.errors = errors;
    sendJSON(res, 200, response);
  };

  routes['GET /api/github/prs'] = (req, res) => {
    const allItems = [];
    const errors = [];
    for (const repo of repos) {
      const result = cachedExec(
        `prs:${repo}`,
        `gh pr list --repo ${repo} --state all --json number,title,state,createdAt,mergedAt,url --limit 20`
      );
      if (result._error) {
        errors.push({ repo, error: result._error });
      } else if (Array.isArray(result)) {
        for (const item of result) {
          item.repo = repo;
          allItems.push(item);
        }
      }
    }
    // Sort by createdAt descending (newest first)
    allItems.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const response = { items: allItems, repos };
    if (errors.length > 0) response.errors = errors;
    sendJSON(res, 200, response);
  };
}

module.exports = { register };
