// content-validator.test.js — Unit tests for the publish-content validator.
// Spins up a local HTTP test server that produces deterministic responses
// per path, then drives validateItem against synthetic items.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { validateItem, fetchUrl } = require('../lib/content-validator');

function startTestServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (p === '/200') { res.writeHead(200); res.end('ok'); return; }
      if (p === '/404') { res.writeHead(404); res.end('nope'); return; }
      if (p === '/500') { res.writeHead(500); res.end('boom'); return; }
      if (p === '/head-405') {
        if (req.method === 'HEAD') { res.writeHead(405); res.end(); }
        else { res.writeHead(200); res.end('ok'); }
        return;
      }
      if (p === '/redirect') { res.writeHead(302, { Location: '/200' }); res.end(); return; }
      if (p === '/redirect-loop') { res.writeHead(302, { Location: '/redirect-loop' }); res.end(); return; }
      if (p === '/slow') { /* never respond */ return; }
      res.writeHead(200); res.end('default');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

let server, port, base;
before(async () => {
  ({ server, port } = await startTestServer());
  base = `http://127.0.0.1:${port}`;
});
after(() => server && server.close());

function makeItem(overrides = {}) {
  return {
    id: 'test-item',
    title: 'Test',
    category: 'comics',
    format: 'cbz',
    source: 'test-source',
    source_url: `${base}/200`,
    status: 'linked',
    sources: [{ name: 'Test Source', url: `${base}/200`, type: 'downloadable' }],
    ...overrides,
  };
}

function makeSources(overrides = {}) {
  return [
    {
      id: 'test-source',
      name: 'Test Source',
      url: base,
      status: 'approved',
      hosts: ['127.0.0.1'],
      ...overrides,
    },
  ];
}

describe('validateItem — required fields', () => {
  it('passes a fully-populated item with all valid URLs', async () => {
    const r = await validateItem(makeItem(), makeSources());
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('rejects when id is missing', async () => {
    const r = await validateItem(makeItem({ id: '' }), makeSources(), { skipFetch: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'id' && /required/i.test(e.reason)));
  });

  it('rejects when source is missing', async () => {
    const r = await validateItem(makeItem({ source: '' }), makeSources(), { skipFetch: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'source'));
  });

  it('rejects a non-object item', async () => {
    const r = await validateItem(null, makeSources(), { skipFetch: true });
    assert.equal(r.ok, false);
    assert.match(r.errors[0].reason, /not an object/);
  });
});

describe('validateItem — primary source lookup', () => {
  it('rejects when item.source references an unknown source id', async () => {
    const r = await validateItem(makeItem({ source: 'unknown-source' }), makeSources(), { skipFetch: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'source' && /not in any approved registry/.test(e.reason)));
  });

  it('rejects pending sources (status != approved)', async () => {
    const pending = makeSources({ status: 'pending' });
    const r = await validateItem(makeItem(), pending, { skipFetch: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'source'));
  });
});

describe('validateItem — host allowlist', () => {
  it('rejects URLs whose host is not in any approved source', async () => {
    const r = await validateItem(
      makeItem({ source_url: 'https://aggregator-fakehulu.example/show' }),
      makeSources(),
      { skipFetch: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'source_url' && /host .* is not in any approved/.test(e.reason)));
  });

  it('rejects each unapproved URL inside sources[]', async () => {
    const r = await validateItem(
      makeItem({
        sources: [
          { name: 'Test Source', url: `${base}/200`, type: 'downloadable' },
          { name: 'Aggregator', url: 'https://aggregator-fakehulu.example/show', type: 'link-only' },
        ],
      }),
      makeSources(),
      { skipFetch: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'sources[1].url'));
  });

  it('derives the host from `url:` when `hosts:` is absent (backwards compat)', async () => {
    const legacy = [{ id: 'test-source', name: 'Test', url: base, status: 'approved' }];
    const r = await validateItem(makeItem(), legacy, { skipFetch: true });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('flags an invalid URL string', async () => {
    const r = await validateItem(makeItem({ source_url: 'not a url' }), makeSources(), { skipFetch: true });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /invalid URL/.test(e.reason)));
  });
});

describe('validateItem — live fetch (skipFetch=false)', () => {
  it('passes 2xx responses', async () => {
    const r = await validateItem(makeItem(), makeSources(), { fetchTimeoutMs: 2000 });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('rejects 404 responses with the status code in the reason', async () => {
    const r = await validateItem(
      makeItem({ source_url: `${base}/404`, sources: [{ name: 'Test', url: `${base}/404`, type: 'downloadable' }] }),
      makeSources(),
      { fetchTimeoutMs: 2000 }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /HTTP 404/.test(e.reason)));
  });

  it('rejects 5xx responses', async () => {
    const r = await validateItem(
      makeItem({ source_url: `${base}/500`, sources: [{ name: 'Test', url: `${base}/500`, type: 'downloadable' }] }),
      makeSources(),
      { fetchTimeoutMs: 2000 }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /HTTP 500/.test(e.reason)));
  });

  it('falls back to GET when HEAD returns 405', async () => {
    const r = await validateItem(
      makeItem({ source_url: `${base}/head-405`, sources: [{ name: 'Test', url: `${base}/head-405`, type: 'downloadable' }] }),
      makeSources(),
      { fetchTimeoutMs: 2000 }
    );
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('follows 3xx redirects', async () => {
    const r = await validateItem(
      makeItem({ source_url: `${base}/redirect`, sources: [{ name: 'Test', url: `${base}/redirect`, type: 'downloadable' }] }),
      makeSources(),
      { fetchTimeoutMs: 2000 }
    );
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('rejects on timeout (short timeout against /slow)', async () => {
    const r = await validateItem(
      makeItem({ source_url: `${base}/slow`, sources: [{ name: 'Test', url: `${base}/slow`, type: 'downloadable' }] }),
      makeSources(),
      { fetchTimeoutMs: 200, fetchRetries: 0 }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /timeout/i.test(e.reason)));
  });

  it('retries recoverable failures', async () => {
    // 0 retries: should fail
    const noRetry = await validateItem(
      makeItem({ source_url: `${base}/slow`, sources: [{ name: 'Test', url: `${base}/slow`, type: 'downloadable' }] }),
      makeSources(),
      { fetchTimeoutMs: 100, fetchRetries: 0 }
    );
    assert.equal(noRetry.ok, false);

    // 2 retries with tiny delay: still fails (slow never responds), but exercises the loop
    const withRetry = await validateItem(
      makeItem({ source_url: `${base}/slow`, sources: [{ name: 'Test', url: `${base}/slow`, type: 'downloadable' }] }),
      makeSources(),
      { fetchTimeoutMs: 100, fetchRetries: 2, fetchRetryDelaysMs: [10, 10] }
    );
    assert.equal(withRetry.ok, false);
    assert.ok(withRetry.errors.some(e => /timeout/i.test(e.reason)));
  });
});

describe('validateItem — skipFetch mode', () => {
  it('passes a 404 URL when skipFetch is true (host check only)', async () => {
    const r = await validateItem(
      makeItem({ source_url: `${base}/404`, sources: [{ name: 'Test', url: `${base}/404`, type: 'downloadable' }] }),
      makeSources(),
      { skipFetch: true }
    );
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('still rejects unapproved hosts in skipFetch mode', async () => {
    const r = await validateItem(
      makeItem({ source_url: 'https://aggregator-fakehulu.example/show' }),
      makeSources(),
      { skipFetch: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => /host .* is not in any approved/.test(e.reason)));
  });
});

describe('validateItem — references[] (supplemental links)', () => {
  it('passes when references[] is absent', async () => {
    const item = makeItem();
    delete item.references;
    const r = await validateItem(item, makeSources(), { fetchTimeoutMs: 2000 });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('passes when references[] is empty array', async () => {
    const r = await validateItem(makeItem({ references: [] }), makeSources(), { fetchTimeoutMs: 2000 });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it('passes when references[] is on a host NOT in approved sources (no host check)', async () => {
    // example.com is not in the approved sources list — references should still pass host-wise
    const r = await validateItem(
      makeItem({ references: [{ name: 'Wikipedia', url: `${base}/200` }] }),
      makeSources({ hosts: ['some-other-host'] }), // approved hosts doesn't include 127.0.0.1
      { fetchTimeoutMs: 2000, skipFetch: true }
    );
    // source_url is on 127.0.0.1 which is NOT in approved hosts → expect a source_url failure
    // BUT references should not contribute a host error
    const refErrors = r.errors.filter(e => e.field && e.field.startsWith('references'));
    assert.equal(refErrors.length, 0, 'references should not trigger host-allowlist errors');
  });

  it('rejects references[].url that returns 404', async () => {
    const r = await validateItem(
      makeItem({ references: [{ name: 'Wikipedia', url: `${base}/404` }] }),
      makeSources(),
      { fetchTimeoutMs: 2000 }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'references[0].url' && /HTTP 404/.test(e.reason)));
  });

  it('rejects references[].url that times out', async () => {
    const r = await validateItem(
      makeItem({ references: [{ name: 'Slow', url: `${base}/slow` }] }),
      makeSources(),
      { fetchTimeoutMs: 200, fetchRetries: 0 }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'references[0].url' && /timeout/i.test(e.reason)));
  });

  it('reports both source and reference failures', async () => {
    const r = await validateItem(
      makeItem({
        source_url: `${base}/500`,
        sources: [{ name: 'Test', url: `${base}/500`, type: 'downloadable' }],
        references: [{ name: 'Wikipedia', url: `${base}/404` }],
      }),
      makeSources(),
      { fetchTimeoutMs: 2000 }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'source_url' && /HTTP 500/.test(e.reason)));
    assert.ok(r.errors.some(e => e.field === 'references[0].url' && /HTTP 404/.test(e.reason)));
  });

  it('flags invalid URL in references[]', async () => {
    const r = await validateItem(
      makeItem({ references: [{ name: 'Broken', url: 'not a url' }] }),
      makeSources(),
      { skipFetch: true }
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some(e => e.field === 'references[0].url' && /invalid URL/.test(e.reason)));
  });

  it('skipFetch bypasses reference liveness too', async () => {
    const r = await validateItem(
      makeItem({ references: [{ name: 'Wikipedia', url: `${base}/404` }] }),
      makeSources(),
      { skipFetch: true }
    );
    // /404 host (127.0.0.1) isn't checked for refs, and skipFetch bypasses fetch — should pass
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });
});

describe('fetchUrl', () => {
  it('returns ok=true for 200', async () => {
    const r = await fetchUrl(`${base}/200`, { fetchTimeoutMs: 2000 });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
  });

  it('returns ok=false with reason for 500', async () => {
    const r = await fetchUrl(`${base}/500`, { fetchTimeoutMs: 2000 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
  });

  it('falls back to GET on HEAD 405', async () => {
    const r = await fetchUrl(`${base}/head-405`, { fetchTimeoutMs: 2000 });
    assert.equal(r.ok, true);
  });

  it('rejects unsupported protocol (file://)', async () => {
    const r = await fetchUrl('file:///etc/passwd', { fetchTimeoutMs: 1000 });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unsupported protocol/);
  });
});
