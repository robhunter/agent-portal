// outputs.js — Output listing, detail, delete, feedback routes
// Registered when features.outputs is true

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody } = require('../helpers');

function getOutputFiles(agentDir) {
  const outputDir = path.join(agentDir, 'output');
  const feedbackDir = path.join(agentDir, 'input', 'feedback');
  const processedDir = path.join(feedbackDir, 'processed');
  try {
    const files = fs.readdirSync(outputDir)
      .filter(f => f.endsWith('.md') && f !== '.gitkeep');
    return files.map(f => {
      const stat = fs.statSync(path.join(outputDir, f));
      const feedbackFile = f.replace('.md', '.feedback.yaml');
      const feedbackPath = path.join(feedbackDir, feedbackFile);
      const processedPath = path.join(processedDir, feedbackFile);
      const activePath = fs.existsSync(feedbackPath) ? feedbackPath
        : fs.existsSync(processedPath) ? processedPath : null;
      let rating = null;
      if (activePath) {
        const content = fs.readFileSync(activePath, 'utf-8');
        const match = content.match(/^rating:\s*(\S+)/m);
        if (match) rating = match[1];
      }
      return {
        filename: f,
        modified: stat.mtime.toISOString(),
        reviewed: !!activePath,
        rating,
      };
    }).sort((a, b) => new Date(b.modified) - new Date(a.modified));
  } catch {
    return [];
  }
}

function register(routes, config) {
  const agentDir = config.agentDir || '.';
  const outputDir = path.join(agentDir, 'output');
  const feedbackDir = path.join(agentDir, 'input', 'feedback');

  // --- Output routes (gated by features.outputs) ---
  if (config.features && config.features.outputs) {
    // GET /api/outputs — list all output files with review status
    routes['GET /api/outputs'] = (req, res) => {
      sendJSON(res, 200, getOutputFiles(agentDir));
    };

    // GET /api/projects/:slug/outputs — per-project outputs
    routes['GET /api/projects/:slug/outputs'] = (req, res) => {
      const slug = req.params.slug;
      const allOutputs = getOutputFiles(agentDir);
      const projectOutputs = allOutputs.filter(o => o.filename.startsWith(slug));
      sendJSON(res, 200, projectOutputs);
    };

    // GET /api/output/:filename — single output file content
    routes['GET /api/output/:filename'] = (req, res) => {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return sendJSON(res, 400, { error: 'Invalid filename' });
      }
      const filePath = path.join(outputDir, filename);
      if (!fs.existsSync(filePath)) {
        return sendJSON(res, 404, { error: 'Not found' });
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      sendJSON(res, 200, { filename, content });
    };

    // DELETE /api/output/:filename — delete output + associated feedback
    routes['DELETE /api/output/:filename'] = (req, res) => {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return sendJSON(res, 400, { error: 'Invalid filename' });
      }
      const filePath = path.join(outputDir, filename);
      if (!fs.existsSync(filePath)) {
        return sendJSON(res, 404, { error: 'Not found' });
      }
      fs.unlinkSync(filePath);
      const feedbackFile = filename.replace('.md', '.feedback.yaml');
      const feedbackPath = path.join(feedbackDir, feedbackFile);
      if (fs.existsSync(feedbackPath)) {
        fs.unlinkSync(feedbackPath);
      }
      sendJSON(res, 200, { ok: true, deleted: filename });
    };
  }

  // --- Feedback routes (enabled when outputs or feedback is enabled) ---
  if (config.features && (config.features.feedback || config.features.outputs)) {
    // GET /api/feedback/:filename — get feedback for an output
    routes['GET /api/feedback/:filename'] = (req, res) => {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return sendJSON(res, 400, { error: 'Invalid filename' });
      }
      const feedbackFile = filename.replace('.md', '.feedback.yaml');
      const feedbackPath = path.join(feedbackDir, feedbackFile);
      if (!fs.existsSync(feedbackPath)) {
        return sendJSON(res, 404, { error: 'No feedback' });
      }
      const content = fs.readFileSync(feedbackPath, 'utf-8');
      sendJSON(res, 200, { filename: feedbackFile, content });
    };

    // POST /api/feedback/:filename — submit feedback for an output
    routes['POST /api/feedback/:filename'] = (req, res) => {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return sendJSON(res, 400, { error: 'Invalid filename' });
      }

      readBody(req).then(body => {
        try {
          const data = JSON.parse(body);
          const rating = data.rating ? parseInt(data.rating, 10) : null;
          if (rating !== null && (rating < 1 || rating > 2)) {
            return sendJSON(res, 400, { error: 'Rating must be 1 (thumbs down) or 2 (thumbs up)' });
          }
          const notes = (data.notes || '').trim();
          if (!rating && !notes) {
            return sendJSON(res, 400, { error: 'Provide a rating and/or notes' });
          }

          const feedbackFile = filename.replace('.md', '.feedback.yaml');
          const feedbackPath = path.join(feedbackDir, feedbackFile);
          // Ensure feedback directory exists
          if (!fs.existsSync(feedbackDir)) {
            fs.mkdirSync(feedbackDir, { recursive: true });
          }

          const now = new Date().toISOString();
          let yaml = `output: ${filename}\nreviewed_at: ${now}\n`;
          if (rating) yaml += `rating: ${rating === 2 ? 'up' : 'down'}\n`;
          if (notes) {
            yaml += `notes: |\n${notes.split('\n').map(l => '  ' + l).join('\n')}\n`;
          }
          fs.writeFileSync(feedbackPath, yaml);
          sendJSON(res, 200, { ok: true, file: feedbackFile });
        } catch {
          sendJSON(res, 400, { error: 'Invalid JSON' });
        }
      });
    };
  }
}

module.exports = { register };
