// ui-history-nav.test.js — Behavior tests for projects-sidebar history navigation.
//
// Context: in projects-sidebar mode the SPA loads client-core.js AND url-state.js.
// client-core's switchTab() already calls history.pushState; url-state.js overrides
// switchTab to call the original AND pushURLState() — a second pushState. That double
// push is issue #259 bug 2: every tab switch creates two history entries, the
// intermediate one project-less (state has a `tab` but no `slug`), so a single Back
// press lands on it and popstate's else-branch routes to selectBobboLog() (the
// running-log view) instead of the project.
//
// These tests evaluate the REAL emitted client-JS (client-core + url-state, in
// production concatenation order) in an isolated node:vm context with a minimal
// browser-history model (a push/replace/back stack) — no DOM library / new
// dependency. They assert the user-visible invariant directly: one tab switch =>
// one slug-bearing history entry, and Back returns to the project, not the log view.
//
// The history model is faithful to the only browser behavior the bug depends on:
// pushState appends an entry (truncating any forward entries), replaceState rewrites
// the current entry, and Back fires popstate with the state of the entry navigated to.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { getClientCore } = require('../lib/ui/client-core');
const { getURLStateJS } = require('../lib/ui/url-state');

// Build a projects-sidebar SPA sandbox: real client-core + real url-state, plus a
// shim for the few leaf globals sidebar-projects.js provides in production
// (currentSlug, selectProject, selectBobboLog, renderSidebar, TAB_LOADERS). The
// history object and the popstate listener registry live host-side so the test can
// drive Back and inspect recorded pushState/replaceState calls.
function makeProjectsModeContext() {
  const noop = () => {};
  const pushCalls = [];
  const replaceCalls = [];
  const handlers = {};

  // Minimal browser-history stack: an array of {state,url} with a current index.
  const stack = [];
  let idx = -1;
  const history = {
    pushState(state, _title, url) {
      stack.splice(idx + 1); // a new push truncates any forward entries
      stack.push({ state, url });
      idx = stack.length - 1;
      pushCalls.push({ state, url });
    },
    replaceState(state, _title, url) {
      if (idx < 0) { stack.push({ state, url }); idx = 0; } else { stack[idx] = { state, url }; }
      replaceCalls.push({ state, url });
    },
  };

  const fakeEl = () => ({
    style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    dataset: {},
    textContent: '',
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const location = { search: '', pathname: '/', href: 'http://portal.test/' };

  const sandbox = {
    window: {
      fetch: () => Promise.resolve({ status: 200, json: () => Promise.resolve({}) }),
      location,
      addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
    },
    location,
    document: {
      getElementById: () => fakeEl(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      createElement: () => fakeEl(),
      body: fakeEl(),
    },
    history,
    URLSearchParams,
    performance: { now: () => 0, getEntriesByType: () => [] },
    localStorage: { getItem: () => null, setItem: noop },
    PORTAL_CONFIG: { tabs: ['journal', 'outputs'], harnessLabel: 'Claude' },
    setInterval: () => 0,
    clearInterval: noop,
    setTimeout: () => 0,
    console,
  };
  sandbox.globalThis = sandbox;

  // Leaf globals that sidebar-projects.js supplies in production (loaded before
  // url-state.js). selectBobboLog is spied so a test can prove Back did NOT route
  // to the running-log view.
  const SHIM = `
    var currentSlug = null;
    var currentOutputFile = null;
    var TAB_LOADERS = { journal: function(){}, outputs: function(){} };
    function renderSidebar(){}
    var __selectBobboLogCount = 0;
    function selectBobboLog(){ __selectBobboLogCount++; return Promise.resolve(); }
    function selectProject(){ return Promise.resolve(); }
  `;
  // url-state.js reassigns the global switchTab; capture the OVERRIDDEN one.
  const EPILOGUE = `
    globalThis.__api = {
      switchTab: function(tab){ return switchTab(tab); },
      setSlug: function(s){ currentSlug = s; },
      getSlug: function(){ return currentSlug; },
      getTab: function(){ return currentTab; },
      selectBobboLogCount: function(){ return __selectBobboLogCount; },
    };
  `;
  vm.runInNewContext(
    SHIM + '\n' + getClientCore() + '\n' + getURLStateJS() + '\n' + EPILOGUE,
    sandbox,
    { timeout: 5000 },
  );

  // Seed the entry a prior selectProject()/pushURLState() would have created,
  // without counting it as a tab-switch push.
  function seed(state, url) { stack.push({ state, url: url || '/' }); idx = stack.length - 1; }

  // Simulate the browser Back button: move the index back one and fire popstate
  // with the state of the entry navigated to.
  function back() {
    if (idx <= 0) return Promise.resolve();
    idx -= 1;
    const entry = stack[idx];
    return Promise.all((handlers.popstate || []).map((h) => h({ state: entry.state })));
  }

  return { api: sandbox.__api, pushCalls, replaceCalls, location, seed, back };
}

describe('projects-mode history navigation (issue #259 bug 2)', () => {
  it('records exactly one slug-bearing history entry per tab switch', () => {
    const ctx = makeProjectsModeContext();
    // On project "bobbo", viewing its journal (the entry selecting the project made).
    ctx.api.setSlug('bobbo');
    ctx.location.search = '?project=bobbo';
    ctx.seed({ slug: 'bobbo', tab: 'journal', outputFile: null }, '?project=bobbo');

    ctx.api.switchTab('outputs');

    assert.equal(ctx.pushCalls.length, 1, 'one tab switch must add exactly one history entry (pre-fix: two)');
    assert.equal(ctx.replaceCalls.length, 0, 'no replaceState in projects mode tab switch');
    assert.equal(ctx.pushCalls[0].state.slug, 'bobbo', 'the pushed entry must carry the project slug');
    assert.equal(ctx.pushCalls[0].state.tab, 'outputs');
  });

  it('Back after a tab switch returns to the project, not the running-log view', async () => {
    const ctx = makeProjectsModeContext();
    ctx.api.setSlug('bobbo');
    ctx.location.search = '?project=bobbo';
    ctx.seed({ slug: 'bobbo', tab: 'journal', outputFile: null }, '?project=bobbo');

    ctx.api.switchTab('outputs');
    await ctx.back();

    assert.equal(ctx.api.selectBobboLogCount(), 0, 'Back must not fall through to selectBobboLog (the log view)');
    assert.equal(ctx.api.getSlug(), 'bobbo', 'project slug should be restored after Back');
    assert.equal(ctx.api.getTab(), 'journal', 'the previous tab should be restored after Back');
  });
});
