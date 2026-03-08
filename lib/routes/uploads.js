// uploads.js — File upload and serving routes
// Stores uploaded files in {agentDir}/uploads/ for attachment to journal entries, replies, etc.

const fs = require('fs');
const path = require('path');
const { sendJSON, readBody } = require('../helpers');

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
};

function register(routes, config) {
  const agentDir = config.agentDir;
  if (!agentDir) return;

  const uploadsDir = path.join(agentDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // POST /api/upload — accept base64-encoded file in JSON payload
  routes['POST /api/upload'] = async (req, res) => {
    const body = await readBody(req);
    let data;
    try { data = JSON.parse(body); } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }); }

    const filename = (data.filename || '').trim();
    const base64Data = (data.data || '').trim();

    if (!filename || !base64Data) {
      return sendJSON(res, 400, { error: 'filename and data are required' });
    }

    // Sanitize filename: keep only safe characters
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName || safeName === '.' || safeName === '..') {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }

    // Decode base64
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_FILE_SIZE) {
      return sendJSON(res, 400, { error: 'File too large (max 50MB)' });
    }

    // Generate unique filename with timestamp prefix
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const finalName = `${ts}_${base}${ext}`;

    const filePath = path.join(uploadsDir, finalName);
    fs.writeFileSync(filePath, buffer);

    sendJSON(res, 200, { ok: true, filename: finalName, url: `/api/uploads/${finalName}` });
  };

  // GET /api/uploads/:filename — serve uploaded files with correct content type
  routes['GET /api/uploads/:filename'] = (req, res) => {
    const filename = req.params.filename;

    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return sendJSON(res, 400, { error: 'Invalid filename' });
    }

    const filePath = path.join(uploadsDir, filename);
    if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
      return sendJSON(res, 400, { error: 'Invalid path' });
    }

    if (!fs.existsSync(filePath)) {
      return sendJSON(res, 404, { error: 'File not found' });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(data);
  };
}

module.exports = { register };
