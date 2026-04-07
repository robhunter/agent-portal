const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createServer } = require('../lib/server');
const { stripMarkdown } = require('../lib/routes/tts');

// --- Unit tests for stripMarkdown ---

describe('stripMarkdown', () => {
  it('removes heading markers', () => {
    assert.equal(stripMarkdown('# Title\n## Subtitle'), 'Title\nSubtitle');
  });

  it('removes bold and italic markers', () => {
    assert.equal(stripMarkdown('**bold** and *italic* text'), 'bold and italic text');
  });

  it('converts links to text only', () => {
    assert.equal(stripMarkdown('[click here](https://example.com)'), 'click here');
  });

  it('removes images', () => {
    assert.equal(stripMarkdown('![alt text](image.png)'), '');
  });

  it('replaces code blocks with placeholder', () => {
    const md = 'Before\n```js\nconst x = 1;\n```\nAfter';
    const result = stripMarkdown(md);
    assert.ok(result.includes('(code block omitted)'));
    assert.ok(!result.includes('const x'));
  });

  it('strips inline code backticks', () => {
    assert.equal(stripMarkdown('run `npm install` now'), 'run npm install now');
  });

  it('removes task list markers', () => {
    assert.equal(stripMarkdown('- [x] Done\n- [ ] Todo'), 'Done\nTodo');
  });

  it('removes frontmatter', () => {
    const md = '---\ntitle: Test\n---\n\nContent here';
    assert.equal(stripMarkdown(md), 'Content here');
  });

  it('removes HTML tags', () => {
    assert.equal(stripMarkdown('text <em>emphasized</em> end'), 'text emphasized end');
  });

  it('handles empty string', () => {
    assert.equal(stripMarkdown(''), '');
  });
});

// --- Integration tests for TTS routes ---

function createTestServer(envOverrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-test-'));
  const outputDir = path.join(tmpDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  // Write a test output file
  fs.writeFileSync(path.join(outputDir, 'test-output.md'), '# Test\n\nThis is a **test** output file.\n');

  const config = {
    name: 'Test',
    port: 0,
    agentDir: tmpDir,
    _serverStartTime: Date.now(),
    features: { outputs: true },
  };

  const routes = {};
  require('../lib/routes/outputs').register(routes, config);

  // Temporarily set env vars for TTS registration
  const origKey = process.env.GOOGLE_TTS_API_KEY;
  // Clear the key first so "no key" tests work even when env has a real key
  delete process.env.GOOGLE_TTS_API_KEY;
  for (const [k, v] of Object.entries(envOverrides)) {
    process.env[k] = v;
  }
  require('../lib/routes/tts').register(routes, config);
  // Restore env
  if (origKey === undefined) {
    delete process.env.GOOGLE_TTS_API_KEY;
  } else {
    process.env.GOOGLE_TTS_API_KEY = origKey;
  }

  return {
    server: createServer(config, { routes, getHTML: () => '<html>test</html>' }),
    config,
    tmpDir,
    outputDir,
  };
}

describe('TTS routes (no API key)', () => {
  let server, port, tmpDir;

  before(async () => {
    const result = createTestServer();
    server = result.server;
    tmpDir = result.tmpDir;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 404 when TTS is not configured', async () => {
    const res = await fetch(`http://localhost:${port}/api/tts/status`);
    assert.equal(res.status, 404);
  });
});

describe('TTS routes (with API key)', () => {
  let server, port, tmpDir, outputDir;

  before(async () => {
    const result = createTestServer({ GOOGLE_TTS_API_KEY: 'test-key-fake' });
    server = result.server;
    tmpDir = result.tmpDir;
    outputDir = result.outputDir;
    await new Promise(resolve => server.listen(0, resolve));
    port = server.address().port;
  });

  after(() => {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/tts/status returns available', async () => {
    const res = await fetch(`http://localhost:${port}/api/tts/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.available, true);
  });

  it('returns 404 for non-existent output file', async () => {
    const res = await fetch(`http://localhost:${port}/api/tts/nonexistent.md`);
    assert.equal(res.status, 404);
  });

  it('returns 400 for path traversal attempts', async () => {
    const res = await fetch(`http://localhost:${port}/api/tts/..%2F..%2Fetc%2Fpasswd`);
    assert.equal(res.status, 400);
  });

  it('serves cached MP3 if it exists', async () => {
    // Create a cached MP3 file
    const fakeMp3 = Buffer.from('fake-mp3-data');
    fs.writeFileSync(path.join(outputDir, 'test-output.mp3'), fakeMp3);

    const res = await fetch(`http://localhost:${port}/api/tts/test-output.md`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'audio/mpeg');
    assert.equal(res.headers.get('x-tts-cache'), 'hit');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(buf, fakeMp3);

    // Cleanup
    fs.unlinkSync(path.join(outputDir, 'test-output.mp3'));
  });
});

describe('TTS button in UI', () => {
  it('includes listen button when hasTTS is in PORTAL_CONFIG', () => {
    const { getOutputsTabJS } = require('../lib/ui/tabs/outputs');
    const js = getOutputsTabJS();
    assert.ok(js.includes('listenToOutput'));
    assert.ok(js.includes('listen-btn'));
    assert.ok(js.includes('PORTAL_CONFIG.hasTTS'));
  });

  it('includes audio player controls (scrub bar, skip, speed)', () => {
    const { getOutputsTabJS } = require('../lib/ui/tabs/outputs');
    const js = getOutputsTabJS();
    assert.ok(js.includes('tts-player'), 'player container');
    assert.ok(js.includes('tts-scrub'), 'scrub bar');
    assert.ok(js.includes('tts-playpause'), 'play/pause button');
    assert.ok(js.includes('ttsSkip(-10)'), 'skip back 10s');
    assert.ok(js.includes('ttsSkip(10)'), 'skip forward 10s');
    assert.ok(js.includes('tts-speed'), 'speed dropdown');
    assert.ok(js.includes('ttsSetSpeed'), 'speed setter');
  });

  it('includes all playback speed options', () => {
    const { getOutputsTabJS } = require('../lib/ui/tabs/outputs');
    const js = getOutputsTabJS();
    for (const speed of ['1', '1.1', '1.2', '1.3', '1.5', '1.75', '2']) {
      assert.ok(js.includes('value="' + speed + '"'), 'speed option ' + speed);
    }
  });

  it('persists playback speed to localStorage', () => {
    const { getOutputsTabJS } = require('../lib/ui/tabs/outputs');
    const js = getOutputsTabJS();
    assert.ok(js.includes("localStorage.getItem('ttsPlaybackRate')"), 'reads from localStorage');
    assert.ok(js.includes("localStorage.setItem('ttsPlaybackRate'"), 'writes to localStorage');
  });
});
