// ui-client-helpers.test.js — Behavior tests for the PURE client-side helper
// functions emitted by the UI modules.
//
// Context: the portal's client-side JS lives in lib/ui/*.js as template-literal
// strings (get*JS() functions) that are embedded into the SPA <script>. ui.test.js
// only ever checked that those strings are *present* and *syntactically valid*
// (via `new Function`) — it never executed the functions, so their behavior had
// ZERO regression coverage. These functions include escapeHtml, the portal's
// HTML-escaping defense used across every tab.
//
// This suite evaluates each emitted JS string in an isolated node:vm context
// (with minimal global stubs so top-level side-effects don't throw) and asserts
// the BEHAVIOR of the pure helpers — no DOM library / new dependency required.
// It establishes the dep-free pattern for client-behavior testing.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { getClientCore } = require('../lib/ui/client-core');
const { getOutputsTabJS } = require('../lib/ui/tabs/outputs');

// Evaluate an emitted client-JS string in a sandbox and pull out the named
// top-level function declarations. The stubs cover every global the modules
// touch at top level (window.fetch wrap, the jump-to-top IIFE, drag/drop
// listeners, PORTAL_CONFIG.tabs, localStorage) so evaluation is side-effect-safe.
function loadHelpers(jsString, names) {
  const noop = () => {};
  const fakeEl = { style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop };
  const sandbox = {
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
  };
  sandbox.globalThis = sandbox;
  const exportLines = names.map((n) => `globalThis.__helpers.${n} = ${n};`).join('\n');
  vm.runInNewContext(`var __helpers = {};\n${jsString}\n${exportLines}`, sandbox, { timeout: 5000 });
  return sandbox.__helpers;
}

describe('client-core pure helpers', () => {
  const { escapeHtml, formatUptime, buildSvgChart } = loadHelpers(
    getClientCore(),
    ['escapeHtml', 'formatUptime', 'buildSvgChart']
  );

  describe('escapeHtml', () => {
    it('escapes the four HTML-significant characters', () => {
      assert.equal(escapeHtml('<'), '&lt;');
      assert.equal(escapeHtml('>'), '&gt;');
      assert.equal(escapeHtml('&'), '&amp;');
      assert.equal(escapeHtml('"'), '&quot;');
    });

    it('neutralizes a script-injection payload', () => {
      assert.equal(
        escapeHtml('<script>alert("x")</script>'),
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
      );
    });

    it('escapes ampersand FIRST so output is not double-escaped (load-bearing ordering)', () => {
      // The classic bug: escaping '<' -> '&lt;' before '&' re-escapes the new '&'
      // into '&amp;lt;'. Correct output for a literal '<' is exactly '&lt;'.
      assert.equal(escapeHtml('<'), '&lt;', "must be '&lt;', not '&amp;lt;'");
      // A literal entity-looking string round-trips to a single amp-escape.
      assert.equal(escapeHtml('&lt;'), '&amp;lt;');
      assert.equal(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
    });

    it('leaves single quotes unescaped (documents the contract: text + double-quoted attrs only)', () => {
      assert.equal(escapeHtml("it's a test"), "it's a test");
    });

    it('is a no-op for strings with no significant characters', () => {
      assert.equal(escapeHtml('plain text 123'), 'plain text 123');
      assert.equal(escapeHtml(''), '');
    });
  });

  describe('formatUptime', () => {
    it('renders sub-minute durations in seconds', () => {
      assert.equal(formatUptime(0), '0s');
      assert.equal(formatUptime(45), '45s');
      assert.equal(formatUptime(59), '59s');
    });

    it('renders sub-hour durations in whole minutes', () => {
      assert.equal(formatUptime(60), '1m');
      assert.equal(formatUptime(119), '1m');
      assert.equal(formatUptime(3599), '59m');
    });

    it('renders multi-hour durations as Hh Mm', () => {
      assert.equal(formatUptime(3600), '1h 0m');
      assert.equal(formatUptime(3661), '1h 1m');
      assert.equal(formatUptime(90061), '25h 1m'); // no day rollover by design
    });
  });

  describe('buildSvgChart', () => {
    const series = [
      { date: '2026-06-01', cycles: 5 },
      { date: '2026-06-02', cycles: 0 },
      { date: '2026-06-03', cycles: 3 },
    ];

    it('returns a well-formed <svg> string', () => {
      const svg = buildSvgChart(series, 'cycles', '#1565c0', 'cycles');
      assert.equal(typeof svg, 'string');
      assert.ok(svg.startsWith('<svg'), 'starts with <svg');
      assert.ok(svg.trimEnd().endsWith('</svg>'), 'ends with </svg>');
    });

    it('renders one bar (<rect>) per data point with a value tooltip', () => {
      const svg = buildSvgChart(series, 'cycles', '#1565c0', 'cycles');
      assert.equal((svg.match(/<rect /g) || []).length, series.length);
      assert.ok(svg.includes('<title>2026-06-01: 5 cycles</title>'));
      assert.ok(svg.includes('<title>2026-06-02: 0 cycles</title>'));
    });

    it('keeps the y-axis ceiling >= the max value so bars never overflow (load-bearing)', () => {
      const svg = buildSvgChart(series, 'cycles', '#1565c0', 'cycles');
      // Y-axis grid labels are emitted as <text ...>N</text>; the largest is yMax.
      const labels = [...svg.matchAll(/class="ts-axis-label">(\d+)<\/text>/g)].map((m) => Number(m[1]));
      const yMax = Math.max(...labels);
      const maxVal = Math.max(...series.map((d) => d.cycles));
      assert.ok(yMax >= maxVal, `y-axis ceiling ${yMax} must be >= max value ${maxVal}`);
    });

    it('renders an X-axis MM/DD label from the YYYY-MM-DD date', () => {
      const svg = buildSvgChart(series, 'cycles', '#1565c0', 'cycles');
      assert.ok(svg.includes('>06/01</text>'), 'first day labelled 06/01');
    });

    it('does not divide-by-zero when all values are zero', () => {
      const flat = [{ date: '2026-06-01', cycles: 0 }, { date: '2026-06-02', cycles: 0 }];
      const svg = buildSvgChart(flat, 'cycles', '#000', 'cycles');
      assert.ok(svg.startsWith('<svg'));
      assert.ok(!svg.includes('NaN'), 'no NaN coordinates');
    });
  });
});

describe('outputs tab pure helpers', () => {
  const { formatTime } = loadHelpers(getOutputsTabJS(), ['formatTime']);

  describe('formatTime (audio scrubber M:SS)', () => {
    it('zero-pads the seconds field (load-bearing for M:SS display)', () => {
      assert.equal(formatTime(5), '0:05');
      assert.equal(formatTime(9), '0:09');
      assert.equal(formatTime(65), '1:05');
    });

    it('formats whole minutes and seconds correctly', () => {
      assert.equal(formatTime(59), '0:59');
      assert.equal(formatTime(60), '1:00');
      assert.equal(formatTime(600), '10:00');
      assert.equal(formatTime(3661), '61:01'); // minutes are not rolled into hours
    });

    it('falls back to 0:00 for falsy or non-finite input', () => {
      assert.equal(formatTime(0), '0:00');
      assert.equal(formatTime(NaN), '0:00');
      assert.equal(formatTime(Infinity), '0:00');
      assert.equal(formatTime(undefined), '0:00');
    });
  });
});
