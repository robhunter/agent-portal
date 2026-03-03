// projects.js — Project listing, per-project journals, project files
// Registered when sidebar.type === 'projects'

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody, parseJournal, parseFrontmatter, editJournalEntry } = require('../helpers');

function getOutputFiles(agentDir) {
  const outputDir = path.join(agentDir, 'output');
  const feedbackDir = path.join(agentDir, 'input', 'feedback');
  const processedDir = path.join(feedbackDir, 'processed');
  try {
    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.md') && f !== '.gitkeep');
    return files.map(f => {
      const feedbackFile = f.replace('.md', '.feedback.yaml');
      const feedbackPath = path.join(feedbackDir, feedbackFile);
      const processedPath = path.join(processedDir, feedbackFile);
      const reviewed = fs.existsSync(feedbackPath) || fs.existsSync(processedPath);
      return { filename: f, reviewed };
    });
  } catch {
    return [];
  }
}

function getProjects(agentDir, journalsDir, projectsDir) {
  try {
    const files = fs.readdirSync(projectsDir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'));

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const allOutputs = getOutputFiles(agentDir);

    return files.map(f => {
      const slug = f.replace('.md', '');
      const content = fs.readFileSync(path.join(projectsDir, f), 'utf-8');
      const fm = parseFrontmatter(content);

      const titleMatch = content.match(/^# (.+)$/m);
      const title = titleMatch ? titleMatch[1] : slug;

      const journalPath = path.join(journalsDir, slug + '.md');
      let entryCount = 0;
      let lastActivity = null;
      if (fs.existsSync(journalPath)) {
        const journalContent = fs.readFileSync(journalPath, 'utf-8');
        const entries = parseJournal(journalContent);
        entryCount = entries.length;
        if (entries.length > 0) {
          lastActivity = entries[entries.length - 1].ts;
        }
      }

      const projectOutputs = allOutputs.filter(o => o.filename.startsWith(slug));
      const outputCount = projectOutputs.length;
      const unreviewedCount = projectOutputs.filter(o => !o.reviewed).length;

      return {
        slug,
        title,
        status: fm.status || 'active',
        priority: fm.priority || 'medium',
        tags: Array.isArray(fm.tags) ? fm.tags : [],
        entryCount,
        lastActivity,
        outputCount,
        unreviewedCount,
      };
    }).sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 3;
      const pb = priorityOrder[b.priority] ?? 3;
      return pa - pb;
    });
  } catch {
    return [];
  }
}

function register(routes, config) {
  if (!config.sidebar || config.sidebar.type !== 'projects') return;

  const agentDir = config.agentDir || '.';
  const journalsDir = path.join(agentDir, 'journals');
  const projectsDir = path.join(agentDir, config.sidebar.projectsDir || 'projects');

  // GET /api/projects — list all projects with metadata
  routes['GET /api/projects'] = (req, res) => {
    sendJSON(res, 200, getProjects(agentDir, journalsDir, projectsDir));
  };

  // GET /api/projects/:slug/journal — per-project journal entries
  routes['GET /api/projects/:slug/journal'] = (req, res) => {
    const slug = req.params.slug;
    const journalPath = path.join(journalsDir, slug + '.md');
    if (!journalPath.startsWith(journalsDir)) {
      return sendJSON(res, 400, { error: 'Invalid slug' });
    }
    if (!fs.existsSync(journalPath)) {
      return sendJSON(res, 200, { slug, entries: [] });
    }
    const content = fs.readFileSync(journalPath, 'utf-8');
    const entries = parseJournal(content);
    sendJSON(res, 200, { slug, entries });
  };

  // POST /api/projects/:slug/journal — append to per-project journal
  routes['POST /api/projects/:slug/journal'] = (req, res) => {
    const slug = req.params.slug;
    const journalPath = path.join(journalsDir, slug + '.md');
    if (!journalPath.startsWith(journalsDir)) {
      return sendJSON(res, 400, { error: 'Invalid slug' });
    }

    readBody(req).then(body => {
      try {
        const data = JSON.parse(body);
        const text = (data.text || '').trim();
        const tag = (data.tag || 'note').trim();
        if (!text) {
          return sendJSON(res, 400, { error: 'Text is required' });
        }
        const validTags = ['output', 'feedback', 'outcome', 'observation', 'note', 'direction', 'question'];
        if (!validTags.includes(tag)) {
          return sendJSON(res, 400, { error: 'Invalid tag. Must be one of: ' + validTags.join(', ') });
        }

        const ts = new Date().toISOString();
        const entry = `\n### ${ts} | rob | ${tag}\n${text}\n`;

        if (!fs.existsSync(journalPath)) {
          const projectTitle = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const header = `# ${projectTitle} — Journal\n\nProject: [${slug}](../projects/${slug}.md)\n\n---\n`;
          fs.writeFileSync(journalPath, header + entry);
        } else {
          fs.appendFileSync(journalPath, entry);
        }

        sendJSON(res, 200, { ok: true, ts, tag });
      } catch {
        sendJSON(res, 400, { error: 'Invalid JSON' });
      }
    });
  };

  // PUT /api/projects/:slug/journal — edit a per-project journal entry
  routes['PUT /api/projects/:slug/journal'] = (req, res) => {
    const slug = req.params.slug;
    const journalPath = path.join(journalsDir, slug + '.md');
    if (!journalPath.startsWith(journalsDir)) {
      return sendJSON(res, 400, { error: 'Invalid slug' });
    }

    readBody(req).then(body => {
      try {
        const data = JSON.parse(body);
        const ts = (data.ts || '').trim();
        const text = (data.text || '').trim();
        const tag = (data.tag || '').trim();
        if (!ts) return sendJSON(res, 400, { error: 'ts is required' });
        if (!text) return sendJSON(res, 400, { error: 'text is required' });
        const validTags = ['output', 'feedback', 'outcome', 'observation', 'note', 'direction', 'question'];
        if (!tag || !validTags.includes(tag)) {
          return sendJSON(res, 400, { error: 'Invalid tag. Must be one of: ' + validTags.join(', ') });
        }

        if (!editJournalEntry(journalPath, ts, text, tag)) {
          return sendJSON(res, 404, { error: 'Entry not found' });
        }

        sendJSON(res, 200, { ok: true, ts, tag });
      } catch {
        sendJSON(res, 400, { error: 'Invalid JSON' });
      }
    });
  };

  // GET /api/projects/:slug/file — raw project definition markdown
  routes['GET /api/projects/:slug/file'] = (req, res) => {
    const slug = req.params.slug;
    const filePath = path.join(projectsDir, slug + '.md');
    if (!filePath.startsWith(projectsDir)) {
      return sendJSON(res, 400, { error: 'Invalid slug' });
    }
    if (!fs.existsSync(filePath)) {
      return sendJSON(res, 404, { error: 'Project file not found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    sendJSON(res, 200, { slug, content });
  };
}

module.exports = { register };
