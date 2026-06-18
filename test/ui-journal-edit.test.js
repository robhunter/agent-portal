// ui-journal-edit.test.js — Behavior tests for journal edit-button entry targeting.
//
// Context: issue #259 bug 1. The journal renders each entry's Edit button with a
// positional array index baked into its onclick at render time. Infinite-scroll
// (_loadOlderEntriesAuto) PREPENDS older entries — `_journalEntries =
// older.concat(_journalEntries)` — which shifts every existing entry's index by
// older.length. The code re-numbers the DOM container ids to match the new
// positions but the existing buttons' baked-in onclick indices were left stale, so
// after older entries load, clicking Edit on a previously-rendered entry resolved
// `_journalEntries[oldIndex]` — a DIFFERENT (prepended) entry — and a Save then PUT
// the wrong entry's ts: a wrong-entry edit (journal data corruption).
//
// The fix keys the edit handlers off each entry's STABLE ts (a sanitized,
// alphanumeric key) instead of its array position, so resolution is position-
// independent: renderJournalEntry emits the key, and startEditEntry / saveEditEntry
// resolve the CURRENT index from it via _findJournalEntryByKey. The container DOM id
// stays positional (kept in sync by _loadOlderEntriesAuto's re-numbering) and is
// addressed by the freshly-resolved index.
//
// These tests run the REAL emitted client-core JS in an isolated node:vm context and
// drive the full render -> prepend -> click flow by EXECUTING the actual onclick
// string the browser would run — no DOM library / new dependency. The only DOM
// surface stubbed is what the edit path touches (getElementById, a body element's
// innerHTML, the edit-form input values, and fetch), so the assertions ride on the
// real entry-resolution logic.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { getClientCore } = require('../lib/ui/client-core');

// Build a journal sandbox: real client-core in a vm context, with a getElementById
// stub that records which container id the edit path addressed and captures the
// edit-form HTML written into the entry body, plus a fetch stub that captures the
// PUT body (so a Save's target ts can be asserted). Returns helpers plus the raw vm
// context so a test can execute an extracted onclick string exactly as the browser would.
function makeJournalContext() {
  const noop = () => {};
  const calls = { getIds: [], fetches: [] };
  let capturedFormHtml = null;

  // The body element startEditEntry writes the edit form into.
  const bodyEl = {
    set innerHTML(v) { capturedFormHtml = v; },
    get innerHTML() { return capturedFormHtml; },
  };

  // A benign element for ids the edit path doesn't care about (e.g. 'content',
  // which the post-save loadJournal() reload writes into) so reload doesn't crash.
  const genericEl = () => ({ value: '', style: {}, scrollHeight: 0, scrollTop: 0, set innerHTML(_v) {}, get innerHTML() { return ''; }, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop, focus: noop });

  function getElementById(id) {
    calls.getIds.push(id);
    if (id.indexOf('entry-') === 0) {
      return { id, querySelector: (sel) => (sel === '.journal-entry-body' ? bodyEl : null) };
    }
    if (id.indexOf('edit-text-') === 0) return { value: 'EDITED TEXT' };
    if (id.indexOf('edit-tag-') === 0) return { value: 'note' };
    return genericEl();
  }

  const fetchStub = (url, opts) => {
    calls.fetches.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
  };

  const sandbox = {
    window: { fetch: fetchStub },
    fetch: fetchStub,
    document: {
      getElementById,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: () => ({ style: {} }),
      body: { style: {} },
    },
    performance: { now: () => 0, getEntriesByType: () => [] },
    localStorage: { getItem: () => null, setItem: noop },
    PORTAL_CONFIG: { tabs: ['journal'], harnessLabel: 'Claude' },
    setInterval: () => 0,
    clearInterval: noop,
    setTimeout: () => 0,
    console,
    marked: { parse: (s) => s },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  const EPILOGUE = `
    globalThis.__api = {
      render: function(e, idx){ return renderJournalEntry(e, idx); },
      setEntries: function(a){ _journalEntries = a; },
      keyOf: function(ts){ return _journalEntryKey(ts); },
    };
  `;
  vm.runInContext(getClientCore() + '\n' + EPILOGUE, context, { timeout: 5000 });

  // Execute a literal onclick attribute string exactly as the browser would.
  function click(onclick) { return vm.runInContext(onclick, context); }

  return {
    api: sandbox.__api,
    calls,
    click,
    formHtml: () => capturedFormHtml,
  };
}

// Pull the onclick attribute out of a rendered entry's HTML.
function onclickOf(html) {
  const m = html.match(/class="edit-entry-btn" onclick="([^"]*)"/);
  return m ? m[1] : null;
}

describe('journal edit-button entry targeting (issue #259 bug 1)', () => {
  it('renderJournalEntry bakes the entry stable key, not the positional index', () => {
    const ctx = makeJournalContext();
    const e = { author: 'rob', tag: 'note', ts: '2026-06-10T08:00:05Z', content: 'hello' };
    const onclick = onclickOf(ctx.api.render(e, 7));
    assert.ok(onclick, 'rob entries render an edit button');
    assert.equal(onclick, `startEditEntry('${ctx.api.keyOf(e.ts)}', false)`);
    assert.ok(!/startEditEntry\(7\b/.test(onclick), 'must not bake the positional index 7');
  });

  it('renders no edit button for non-rob authors', () => {
    const ctx = makeJournalContext();
    const html = ctx.api.render({ author: 'coder', tag: 'cycle', ts: '2026-06-10T08:00:05Z', content: 'x' }, 0);
    assert.ok(!html.includes('edit-entry-btn'), 'edit button is rob-only');
  });

  it('Edit opens the clicked entry after an infinite-scroll prepend shifts indices', () => {
    const ctx = makeJournalContext();
    // Original page: 3 rob entries at indices 0,1,2.
    const orig = [
      { author: 'rob', tag: 'note', ts: '2026-06-10T08:00:00Z', content: 'ORIGINAL-0' },
      { author: 'rob', tag: 'note', ts: '2026-06-10T08:00:01Z', content: 'ORIGINAL-1' },
      { author: 'rob', tag: 'note', ts: '2026-06-10T08:00:02Z', content: 'ORIGINAL-2' },
    ];
    ctx.api.setEntries(orig);
    // Capture the Edit onclick for the entry rendered at index 2 (ORIGINAL-2).
    const onclick = onclickOf(ctx.api.render(orig[2], 2));

    // Infinite-scroll prepends 3 older entries (exactly _loadOlderEntriesAuto's
    // `older.concat(_journalEntries)`); ORIGINAL-2 moves from index 2 to index 5.
    const older = [
      { author: 'rob', tag: 'note', ts: '2026-06-09T07:00:00Z', content: 'PREPEND-0' },
      { author: 'rob', tag: 'note', ts: '2026-06-09T07:00:01Z', content: 'PREPEND-1' },
      { author: 'rob', tag: 'note', ts: '2026-06-09T07:00:02Z', content: 'PREPEND-2' },
    ];
    ctx.api.setEntries(older.concat(orig));

    // Click the (previously-rendered) Edit button for ORIGINAL-2.
    ctx.click(onclick);

    const form = ctx.formHtml();
    assert.ok(form, 'an edit form was opened');
    assert.ok(form.includes('ORIGINAL-2'), 'the clicked entry ORIGINAL-2 must open for editing');
    assert.ok(!form.includes('PREPEND-2'), 'must not open a prepended entry (the stale-index bug)');
    // The container addressed must be ORIGINAL-2's CURRENT position (index 5), the
    // id _loadOlderEntriesAuto re-numbered it to — not its stale render-time index 2.
    assert.ok(ctx.calls.getIds.includes('entry-5'), 'addresses the current container id entry-5');
    assert.ok(!ctx.calls.getIds.includes('entry-2'), 'does not address the stale container id entry-2');
  });

  it('Save after a prepend PUTs the clicked entry stable ts (no wrong-entry edit)', async () => {
    const ctx = makeJournalContext();
    const orig = [
      { author: 'rob', tag: 'note', ts: '2026-06-10T08:00:00Z', content: 'ORIGINAL-0' },
      { author: 'rob', tag: 'note', ts: '2026-06-10T08:00:02Z', content: 'ORIGINAL-2' },
    ];
    ctx.api.setEntries(orig);
    const editOnclick = onclickOf(ctx.api.render(orig[1], 1)); // ORIGINAL-2 at index 1

    const older = [
      { author: 'rob', tag: 'note', ts: '2026-06-09T07:00:00Z', content: 'PREPEND-0' },
      { author: 'rob', tag: 'note', ts: '2026-06-09T07:00:01Z', content: 'PREPEND-1' },
    ];
    ctx.api.setEntries(older.concat(orig)); // ORIGINAL-2 now at index 3

    ctx.click(editOnclick);
    // Extract the Save button's onclick from the opened edit form and fire it.
    const saveOnclick = (ctx.formHtml().match(/<button onclick="(saveEditEntry[^"]*)"/) || [])[1];
    assert.ok(saveOnclick, 'edit form has a Save button');
    await ctx.click(saveOnclick);

    const put = ctx.calls.fetches.find((f) => f.opts && f.opts.method === 'PUT');
    assert.ok(put, 'Save issues a PUT');
    assert.equal(put.url, '/api/journal');
    assert.equal(put.body.ts, '2026-06-10T08:00:02Z', 'PUT targets ORIGINAL-2 ts, not a prepended entry');
  });

  it('two distinct entries resolve to distinct stable keys', () => {
    const ctx = makeJournalContext();
    assert.notEqual(ctx.api.keyOf('2026-06-10T08:00:00Z'), ctx.api.keyOf('2026-06-10T08:00:01Z'));
  });
});
