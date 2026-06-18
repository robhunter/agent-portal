// ui-render-markdown.test.js — Behavior + wiring tests for renderMarkdown, the
// client-side markdown→HTML render helper that feeds innerHTML at 14 sites.
//
// THE BUG (issue #262): every journal / today.md / roadmap / output / todo / request
// field was rendered with marked.parse(...) straight into innerHTML. Current marked does
// NOT sanitize raw HTML in markdown (the sanitize option was removed in v0.7+), and the
// portal sets no Content-Security-Policy, so any field carrying externally-derived content
// was a stored-XSS sink. THE FIX: renderMarkdown pipes marked output through DOMPurify
// before it reaches innerHTML, with a fail-safe fallback to raw marked output if DOMPurify
// did not load (so rendering can never regress).
//
// These tests evaluate the emitted client JS string in an isolated node:vm context with
// injectable marked / DOMPurify stubs (no DOM library / new dependency — the established
// dep-free client-behavior pattern from ui-client-helpers.test.js), and assert the
// load-bearing property: marked output is routed THROUGH DOMPurify.sanitize. Removing the
// DOMPurify wrap makes the wiring + sink-closed tests fail (bite-verified).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { getClientCore } = require('../lib/ui/client-core');
const { buildHTML } = require('../lib/ui/shell');

// Evaluate the emitted client-JS string in a sandbox with caller-supplied marked /
// DOMPurify stubs and pull out renderMarkdown. Omitting DOMPurify from `extra` leaves
// `typeof DOMPurify === 'undefined'` in the sandbox — the fail-safe path.
function loadRenderMarkdown(extra) {
  const noop = () => {};
  const fakeEl = { style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop };
  const sandbox = Object.assign({
    window: { fetch: noop },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: () => fakeEl,
      body: fakeEl,
    },
    performance: { now: () => 0, getEntriesByType: () => [] },
    localStorage: { getItem: () => null, setItem: noop },
    PORTAL_CONFIG: { tabs: ['journal'], harnessLabel: 'Claude' },
    setInterval: () => 0,
    clearInterval: noop,
    setTimeout: () => 0,
    console,
  }, extra);
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`var __helpers = {};\n${getClientCore()}\nglobalThis.__helpers.renderMarkdown = renderMarkdown;`, sandbox, { timeout: 5000 });
  return sandbox.__helpers.renderMarkdown;
}

// A marked stub that mimics real marked's non-sanitizing behavior: raw HTML in the
// markdown passes straight through (this is precisely why the sink existed).
const passthroughMarked = { parse: (s) => '<p>' + s + '</p>' };

describe('renderMarkdown — wiring (closes the marked→innerHTML XSS sink, #262)', () => {
  it('routes marked output THROUGH DOMPurify.sanitize before returning', () => {
    const calls = [];
    const renderMarkdown = loadRenderMarkdown({
      marked: { parse: (s) => 'MARKED(' + s + ')' },
      DOMPurify: { sanitize: (h) => { calls.push(h); return 'PURIFIED(' + h + ')'; } },
    });
    const out = renderMarkdown('hello');
    // DOMPurify must receive exactly marked's output (correct pipe order)...
    assert.deepEqual(calls, ['MARKED(hello)']);
    // ...and renderMarkdown must return the sanitized result, not the raw marked output.
    assert.equal(out, 'PURIFIED(MARKED(hello))');
  });

  it('neutralizes a script payload that marked would pass straight to innerHTML', () => {
    // Stub DOMPurify with a representative sanitizer (strip <script> + on*= handlers);
    // the real DOMPurify is stronger. The point: a payload that reaches innerHTML raw
    // pre-fix is stripped post-fix.
    const sanitize = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on\w+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const renderMarkdown = loadRenderMarkdown({ marked: passthroughMarked, DOMPurify: { sanitize } });

    const scriptOut = renderMarkdown('<script>alert(1)</script>');
    assert.ok(!/<script/i.test(scriptOut), 'script tag must be stripped');

    const handlerOut = renderMarkdown('<img src=x onerror=alert(1)>');
    assert.ok(!/onerror/i.test(handlerOut), 'event handler must be stripped');
  });

  it('passes ordinary markdown HTML through unharmed (no display regression)', () => {
    // Real DOMPurify preserves benign tags; emulate by returning input unchanged.
    const renderMarkdown = loadRenderMarkdown({ marked: passthroughMarked, DOMPurify: { sanitize: (h) => h } });
    assert.equal(renderMarkdown('**bold** and a [link](https://x.test)'), '<p>**bold** and a [link](https://x.test)</p>');
  });
});

describe('renderMarkdown — input safety', () => {
  const renderMarkdown = loadRenderMarkdown({ marked: passthroughMarked, DOMPurify: { sanitize: (h) => h } });

  it('renders null/undefined as empty (no throw) instead of "null"/"undefined"', () => {
    assert.equal(renderMarkdown(null), '<p></p>');
    assert.equal(renderMarkdown(undefined), '<p></p>');
  });

  it('coerces non-string input to a string', () => {
    assert.equal(renderMarkdown(123), '<p>123</p>');
  });
});

describe('renderMarkdown — fail-safe (DOMPurify absent ⇒ no rendering regression)', () => {
  it('falls back to raw marked output when DOMPurify did not load', () => {
    // No DOMPurify in the sandbox ⇒ typeof DOMPurify === 'undefined'.
    const renderMarkdown = loadRenderMarkdown({ marked: { parse: (s) => 'MARKED(' + s + ')' } });
    assert.equal(renderMarkdown('hi'), 'MARKED(hi)');
  });

  it('does not throw when DOMPurify is present but malformed', () => {
    const renderMarkdown = loadRenderMarkdown({ marked: passthroughMarked, DOMPurify: {} });
    assert.equal(renderMarkdown('x'), '<p>x</p>');
  });
});

describe('shell.js — serves the DOMPurify sanitizer alongside marked', () => {
  const html = buildHTML({ name: 'Test', authors: {}, features: { tabs: ['journal'] }, harness: { type: 'claude-code' } });

  it('loads the DOMPurify CDN script so the global exists in the browser', () => {
    assert.ok(/cdn\.jsdelivr\.net\/npm\/dompurify@\d/.test(html), 'DOMPurify CDN tag must be present');
  });

  it('still loads marked (the render pipeline is intact)', () => {
    assert.ok(/cdn\.jsdelivr\.net\/npm\/marked/.test(html), 'marked CDN tag must remain');
  });

  it('emits renderMarkdown into the client bundle (no bare marked.parse at render sites)', () => {
    assert.ok(html.includes('function renderMarkdown('), 'renderMarkdown helper must be emitted');
    // The only marked.parse left is inside renderMarkdown itself.
    const occurrences = (html.match(/marked\.parse\(/g) || []).length;
    assert.equal(occurrences, 1, 'marked.parse must appear only inside renderMarkdown');
  });
});
