const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildHTML } = require('../lib/ui');

describe('buildHTML', () => {
  const baseConfig = {
    name: 'TestAgent',
    authors: {
      rob: { color: '#1565c0', bg: '#e3f2fd' },
      coder: { color: '#4527a0', bg: '#ede7f6' },
    },
    features: {},
  };

  it('returns valid HTML with agent name in title', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>TestAgent — Agent Portal</title>'));
  });

  it('includes agent name in sidebar header', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('<h1>TestAgent</h1>'));
  });

  it('generates author badge CSS from config', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('.author-badge.rob'));
    assert.ok(html.includes('background: #e3f2fd'));
    assert.ok(html.includes('color: #1565c0'));
    assert.ok(html.includes('.author-badge.coder'));
    assert.ok(html.includes('background: #ede7f6'));
    assert.ok(html.includes('color: #4527a0'));
  });

  it('shows journal and status tabs by default', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('data-tab="journal"'));
    assert.ok(html.includes('data-tab="status"'));
    // GitHub tab should NOT be present without github feature
    assert.ok(!html.includes('data-tab="github"'));
  });

  it('includes GitHub tab when features.github is configured', () => {
    const config = {
      ...baseConfig,
      features: { github: { repos: ['robhunter/agentdeals'] } },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('data-tab="github"'));
    assert.ok(html.includes('"hasGitHub":true'));
  });

  it('does not include GitHub tab without features.github', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('"hasGitHub":false'));
  });

  it('includes marked.js CDN script tag', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('cdn.jsdelivr.net/npm/marked/marked.min.js'));
  });

  it('includes all CSS sections', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('#sidebar'));
    assert.ok(html.includes('.journal-entry'));
    assert.ok(html.includes('.gh-section'));
    assert.ok(html.includes('.status-section'));
    assert.ok(html.includes('.md-content'));
  });

  it('includes all client-side JS functions', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('function escapeHtml'));
    assert.ok(html.includes('function formatTimestamp'));
    assert.ok(html.includes('function switchTab'));
    assert.ok(html.includes('function loadJournal'));
    assert.ok(html.includes('function loadStatus'));
    assert.ok(html.includes('function submitNote'));
    assert.ok(html.includes('function updateStatusDot'));
    assert.ok(html.includes('function loadNextRun'));
    assert.ok(html.includes('function init'));
    // loadGitHub is only included when GitHub feature is enabled
    assert.ok(!html.includes('function loadGitHub'));
  });

  it('includes loadGitHub when GitHub is configured', () => {
    const config = {
      ...baseConfig,
      features: { github: { repos: ['robhunter/agentdeals'] } },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('function loadGitHub'));
  });

  it('embeds PORTAL_CONFIG with correct name', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('"name":"TestAgent"'));
  });

  it('supports custom tab order via features.tabs', () => {
    const config = {
      ...baseConfig,
      features: { tabs: ['status', 'journal'] },
    };
    const html = buildHTML(config);
    // Status should be first (active)
    assert.ok(html.includes('class="tab active" data-tab="status"'));
    // Journal should not be active
    assert.ok(html.includes('class="tab" data-tab="journal"'));
  });

  it('uses default name when not provided', () => {
    const config = { authors: {}, features: {} };
    const html = buildHTML(config);
    assert.ok(html.includes('<title>Agent — Agent Portal</title>'));
    assert.ok(html.includes('<h1>Agent</h1>'));
  });

  it('includes cron toggle and cycle control buttons', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('id="cron-toggle-btn"'));
    assert.ok(html.includes('id="run-cycle-btn"'));
    assert.ok(html.includes('id="run-respond-btn"'));
    assert.ok(html.includes('function toggleCron'));
    assert.ok(html.includes('function runCycle'));
    assert.ok(html.includes('function runRespond'));
  });

  it('includes cycle-running status indicator', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('id="cycle-status"'));
    assert.ok(html.includes('data.cycleRunning'));
  });
});
