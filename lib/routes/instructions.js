const fs = require('fs');
const path = require('path');
const { sendJSON, readBody } = require('../helpers');
const { isCycleLocked } = require('../cron');
const { readInstructions, resolveFrameworkDir, resolveGlobalClaudeMd, findEditable, writeInstruction, instructionHistory, instructionAtRevision } = require('../instructions');

function register(routes, config) {
  const agentDir = config.agentDir || '.';

  routes['GET /api/instructions'] = (req, res) => {
    sendJSON(res, 200, {
      instructions: readInstructions(agentDir, resolveFrameworkDir(config), resolveGlobalClaudeMd(config)),
      cycleRunning: isCycleLocked(config.lockFile),
    });
  };

  routes['GET /api/instructions/:id/history'] = (req, res) => {
    const id = req.params && req.params.id;
    if (!findEditable(id)) {
      return sendJSON(res, 403, { error: 'No history for: ' + id });
    }
    sendJSON(res, 200, { id, revisions: instructionHistory(agentDir, id) });
  };

  routes['GET /api/instructions/:id/history/:sha'] = (req, res) => {
    const id = req.params && req.params.id;
    const sha = req.params && req.params.sha;
    if (!findEditable(id)) {
      return sendJSON(res, 403, { error: 'No history for: ' + id });
    }
    const content = instructionAtRevision(agentDir, id, sha);
    if (content == null) {
      return sendJSON(res, 404, { error: 'No content at that revision' });
    }
    sendJSON(res, 200, { id, sha, content, bytes: Buffer.byteLength(content, 'utf-8') });
  };

  routes['PUT /api/instructions/:id'] = async (req, res) => {
    const id = req.params && req.params.id;
    const target = findEditable(id);
    if (!target) {
      return sendJSON(res, 403, { error: 'Not editable: ' + id });
    }

    if (isCycleLocked(config.lockFile)) {
      return sendJSON(res, 409, {
        error: 'A cycle is running — instructions cannot be saved until it finishes.',
        cycleRunning: true,
      });
    }

    let body;
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJSON(res, 400, { error: 'Invalid JSON body' });
    }

    if (typeof body.content !== 'string') {
      return sendJSON(res, 400, { error: 'content must be a string' });
    }

    const current = readInstructions(agentDir, resolveFrameworkDir(config), resolveGlobalClaudeMd(config)).find(i => i.id === id);
    if (!current) {
      return sendJSON(res, 404, { error: 'No such instruction: ' + id });
    }
    if (body.modified && body.modified !== current.modified) {
      return sendJSON(res, 409, {
        error: 'This file changed on disk since it was loaded. Reload before saving.',
        modified: current.modified,
      });
    }

    try {
      const result = writeInstruction(agentDir, id, body.content);
      return sendJSON(res, 200, {
        ok: true,
        id,
        modified: result.modified,
        committed: result.committed,
        bytes: Buffer.byteLength(body.content, 'utf-8'),
      });
    } catch (err) {
      return sendJSON(res, err.statusCode || 500, { error: err.message });
    }
  };
}

module.exports = { register };
