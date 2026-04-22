// routes/media-files.js — Streaming file serving for media content
// Supports HTTP Range requests (RFC 7233) for in-browser audio/video playback
// Registered when features.library is configured

const fs = require('fs');
const path = require('path');
const { sendJSON } = require('../helpers');

const MIME_TYPES = {
  // Books
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  // Comics
  '.cbz': 'application/x-cbz',
  '.cbr': 'application/x-cbr',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  // Audio
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4b': 'audio/mp4',
  '.m4a': 'audio/mp4',
  // Images (cover art)
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// Formats that should trigger download rather than inline display
const DOWNLOAD_TYPES = new Set(['.epub', '.cbz', '.cbr', '.pdf']);

function register(routes, config) {
  if (!config.features || !config.features.library) return;

  const agentDir = config.agentDir || '.';
  const libraryConfig = typeof config.features.library === 'object' ? config.features.library : {};
  const storagePaths = libraryConfig.storagePaths || {};
  const defaultStorage = storagePaths.default || path.join(agentDir, 'media');

  function resolveStoragePath(category) {
    if (storagePaths[category]) return storagePaths[category];
    return path.join(defaultStorage, category);
  }

  // GET /api/media/file/:category/:filename — stream a media file
  routes['GET /api/media/file/:category/:filename'] = (req, res) => {
    const { category, filename } = req.params;

    // Path traversal protection
    if (category.includes('..') || category.includes('/') || category.includes('\\') ||
        filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return sendJSON(res, 400, { error: 'Invalid path' });
    }

    const baseDir = resolveStoragePath(category);
    const filePath = path.join(baseDir, filename);

    // Ensure resolved path is within the storage root
    const resolved = path.resolve(filePath);
    const resolvedBase = path.resolve(baseDir);
    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      return sendJSON(res, 403, { error: 'Access denied' });
    }

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return sendJSON(res, 404, { error: 'File not found' });
    }

    if (!stat.isFile()) {
      return sendJSON(res, 404, { error: 'Not a file' });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isDownload = DOWNLOAD_TYPES.has(ext);
    const disposition = isDownload ? `attachment; filename="${filename}"` : 'inline';

    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=604800, immutable',
    };

    // Handle Range requests (RFC 7233)
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
      if (!match) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;

      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }

      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;

      res.writeHead(206, headers);
      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
      stream.on('error', () => res.end());
      return;
    }

    // Full file response
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => res.end());
  };

  // GET /api/media/cover/:id — serve cover art with fallback placeholder
  routes['GET /api/media/cover/:id'] = (req, res) => {
    const id = req.params.id;
    if (id.includes('..') || id.includes('/') || id.includes('\\')) {
      return sendJSON(res, 400, { error: 'Invalid id' });
    }

    const coversDir = path.join(agentDir, 'media', 'covers');

    // Try common image extensions
    const exts = ['.jpg', '.jpeg', '.png', '.webp'];
    for (const ext of exts) {
      const coverPath = path.join(coversDir, id + ext);
      if (fs.existsSync(coverPath)) {
        const contentType = MIME_TYPES[ext];
        const stat = fs.statSync(coverPath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=86400',
        });
        fs.createReadStream(coverPath).pipe(res);
        return;
      }
    }

    // Placeholder SVG
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300" viewBox="0 0 200 300">
  <rect width="200" height="300" fill="#f0f0f0"/>
  <text x="100" y="150" text-anchor="middle" font-family="sans-serif" font-size="48" fill="#ccc">?</text>
</svg>`;
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': Buffer.byteLength(svg),
    });
    res.end(svg);
  };
}

module.exports = { register };
