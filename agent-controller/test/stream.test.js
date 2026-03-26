const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { sseHeaders, sseData, sseEnd, streamProcess } = require('../lib/stream');

describe('stream helpers', () => {
  it('sseHeaders sets correct content type', (_, done) => {
    const server = http.createServer((req, res) => {
      sseHeaders(res);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      http.get(`http://127.0.0.1:${server.address().port}`, (res) => {
        assert.equal(res.headers['content-type'], 'text/event-stream');
        assert.equal(res.headers['cache-control'], 'no-cache');
        res.resume();
        res.on('end', () => server.close(done));
      });
    });
  });

  it('sseData produces correct SSE framing', (_, done) => {
    const server = http.createServer((req, res) => {
      sseHeaders(res);
      sseData(res, { line: 'hello' });
      sseData(res, { line: 'world' });
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      http.get(`http://127.0.0.1:${server.address().port}`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const events = body.split('\n\n').filter(e => e.trim());
          assert.equal(events.length, 2);
          assert.ok(events[0].startsWith('data: '));
          const parsed = JSON.parse(events[0].replace('data: ', ''));
          assert.equal(parsed.line, 'hello');
          server.close(done);
        });
      });
    });
  });

  it('sseEnd sends done event', (_, done) => {
    const server = http.createServer((req, res) => {
      sseHeaders(res);
      sseEnd(res, { exitCode: 0 });
    });
    server.listen(0, '127.0.0.1', () => {
      http.get(`http://127.0.0.1:${server.address().port}`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          assert.ok(body.includes('event: done'));
          assert.ok(body.includes('"exitCode":0'));
          server.close(done);
        });
      });
    });
  });

  it('streamProcess streams command output and exits', (_, done) => {
    const server = http.createServer((req, res) => {
      streamProcess(res, 'echo', ['hello world']);
    });
    server.listen(0, '127.0.0.1', () => {
      http.get(`http://127.0.0.1:${server.address().port}`, (res) => {
        assert.equal(res.headers['content-type'], 'text/event-stream');
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          assert.ok(body.includes('hello world'));
          assert.ok(body.includes('event: done'));
          assert.ok(body.includes('"exitCode":0'));
          server.close(done);
        });
      });
    });
  });

  it('streamProcess kills child on client disconnect', (_, done) => {
    const server = http.createServer((req, res) => {
      // Start a process that outputs continuously
      const proc = streamProcess(res, 'sh', ['-c', 'while true; do echo ping; sleep 0.1; done']);
      proc.on('close', () => {
        server.close(done);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const req = http.get(`http://127.0.0.1:${server.address().port}`, (res) => {
        // Wait for first data, then disconnect
        res.once('data', () => {
          res.destroy();
        });
      });
      req.on('error', () => {}); // ignore connection reset error
    });
  });

  it('streamProcess captures stderr', (_, done) => {
    const server = http.createServer((req, res) => {
      streamProcess(res, 'sh', ['-c', 'echo err >&2']);
    });
    server.listen(0, '127.0.0.1', () => {
      http.get(`http://127.0.0.1:${server.address().port}`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          assert.ok(body.includes('"source":"stderr"'));
          assert.ok(body.includes('err'));
          server.close(done);
        });
      });
    });
  });
});
