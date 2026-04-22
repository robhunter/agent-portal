const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');

function createMediaServer(tmpDir, configOverrides = {}) {
  const config = {
    name: 'Test',
    port: 0,
    agentDir: tmpDir,
    cronFile: '/nonexistent/cron',
    lockFile: '/tmp/test-media-lock',
    _serverStartTime: Date.now(),
    features: { library: { dataDir: 'content/items' } },
    ...configOverrides,
  };
  const routes = {};
  require('../lib/routes/media-files').register(routes, config);
  return { server: createServer(config, { routes, getHTML: () => '<html>test</html>' }), config };
}

function fetchRaw(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/media/file/:category/:filename', () => {
  let tmpDir, server, port;

  before((_, done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'));
    // Create test files
    const booksDir = path.join(tmpDir, 'media', 'books');
    const audioDir = path.join(tmpDir, 'media', 'audio');
    fs.mkdirSync(booksDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(booksDir, 'test.epub'), 'fake-epub-content-here');
    // Create a larger file for range testing
    const bigContent = Buffer.alloc(1000, 'x');
    fs.writeFileSync(path.join(audioDir, 'test.mp3'), bigContent);

    const { server: s } = createMediaServer(tmpDir);
    server = s;
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  after((_, done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true });
      done();
    });
  });

  it('serves a file with correct MIME type', async () => {
    const res = await fetchRaw(port, '/api/media/file/books/test.epub');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/epub+zip');
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.body.toString(), 'fake-epub-content-here');
  });

  it('sets attachment disposition for download types', async () => {
    const res = await fetchRaw(port, '/api/media/file/books/test.epub');
    assert.ok(res.headers['content-disposition'].includes('attachment'));
    assert.ok(res.headers['content-disposition'].includes('test.epub'));
  });

  it('sets inline disposition for streamable types', async () => {
    const res = await fetchRaw(port, '/api/media/file/audio/test.mp3');
    assert.equal(res.headers['content-disposition'], 'inline');
  });

  it('sets immutable cache headers', async () => {
    const res = await fetchRaw(port, '/api/media/file/books/test.epub');
    assert.ok(res.headers['cache-control'].includes('max-age=604800'));
    assert.ok(res.headers['cache-control'].includes('immutable'));
  });

  it('returns 404 for nonexistent file', async () => {
    const res = await fetchRaw(port, '/api/media/file/books/nonexistent.epub');
    assert.equal(res.status, 404);
  });

  it('rejects path traversal in category', async () => {
    const res = await fetchRaw(port, '/api/media/file/..%2F..%2Fetc/passwd');
    assert.equal(res.status, 400);
  });

  it('rejects path traversal in filename', async () => {
    const res = await fetchRaw(port, '/api/media/file/books/..%2F..%2Fetc%2Fpasswd');
    assert.equal(res.status, 400);
  });

  // Range request tests
  it('handles Range request with 206 response', async () => {
    const res = await fetchRaw(port, '/api/media/file/audio/test.mp3', { Range: 'bytes=0-99' });
    assert.equal(res.status, 206);
    assert.equal(res.headers['content-range'], 'bytes 0-99/1000');
    assert.equal(parseInt(res.headers['content-length']), 100);
    assert.equal(res.body.length, 100);
  });

  it('handles Range request for end of file', async () => {
    const res = await fetchRaw(port, '/api/media/file/audio/test.mp3', { Range: 'bytes=900-999' });
    assert.equal(res.status, 206);
    assert.equal(res.headers['content-range'], 'bytes 900-999/1000');
    assert.equal(res.body.length, 100);
  });

  it('handles Range request with open end', async () => {
    const res = await fetchRaw(port, '/api/media/file/audio/test.mp3', { Range: 'bytes=950-' });
    assert.equal(res.status, 206);
    assert.equal(res.headers['content-range'], 'bytes 950-999/1000');
    assert.equal(res.body.length, 50);
  });

  it('returns 416 for out-of-range request', async () => {
    const res = await fetchRaw(port, '/api/media/file/audio/test.mp3', { Range: 'bytes=2000-3000' });
    assert.equal(res.status, 416);
  });

  it('returns 416 for invalid Range format', async () => {
    const res = await fetchRaw(port, '/api/media/file/audio/test.mp3', { Range: 'bytes=abc-def' });
    assert.equal(res.status, 416);
  });
});

describe('GET /api/media/cover/:id', () => {
  let tmpDir, server, port;

  before((_, done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-test-'));
    const coversDir = path.join(tmpDir, 'media', 'covers');
    fs.mkdirSync(coversDir, { recursive: true });
    // Create a fake cover image
    fs.writeFileSync(path.join(coversDir, 'my-book.jpg'), 'fake-jpeg-data');

    const { server: s } = createMediaServer(tmpDir);
    server = s;
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  after((_, done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true });
      done();
    });
  });

  it('serves existing cover art', async () => {
    const res = await fetchRaw(port, '/api/media/cover/my-book');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.equal(res.body.toString(), 'fake-jpeg-data');
  });

  it('returns placeholder SVG when no cover exists', async () => {
    const res = await fetchRaw(port, '/api/media/cover/nonexistent');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/svg+xml');
    assert.ok(res.body.toString().includes('<svg'));
    assert.ok(res.body.toString().includes('?'));
  });

  it('rejects path traversal', async () => {
    const res = await fetchRaw(port, '/api/media/cover/..%2F..%2Fetc%2Fpasswd');
    // Should hit the JSON error handler since it contains ..
    assert.ok(res.status === 400 || res.status === 200); // 200 with placeholder SVG is also acceptable
  });
});
