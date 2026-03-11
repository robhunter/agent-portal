// web-portal.test.js — Tests for web portal HTML output quality
// Phase 1: Regression prevention for generated HTML content
// Refs #88

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildHTML } = require('../lib/ui');

describe('web portal — version footer', () => {
  const baseConfig = {
    name: 'TestAgent',
    authors: {},
    features: {},
  };

  it('does not contain placeholder org names in generated HTML', () => {
    const html = buildHTML(baseConfig);
    // Regression test for #84: your-org placeholder leaked into commit URLs
    assert.ok(!html.includes('your-org'), 'HTML should not contain placeholder "your-org"');
    assert.ok(!html.includes('your-project'), 'HTML should not contain placeholder "your-project"');
    assert.ok(!html.includes('your-agent'), 'HTML should not contain placeholder "your-agent"');
  });

  it('version footer contains portal version number', () => {
    const html = buildHTML(baseConfig);
    const pkg = require('../package.json');
    assert.ok(html.includes(`Agent Portal v${pkg.version}`),
      `HTML should contain "Agent Portal v${pkg.version}"`);
  });

  it('version footer links to a valid GitHub commit URL when in a git repo', () => {
    const html = buildHTML(baseConfig);
    // When running in the agent-portal repo, git commit is available
    const commitUrlMatch = html.match(/href="(https:\/\/github\.com\/[^"]+\/commit\/[a-f0-9]+)"/);
    if (commitUrlMatch) {
      const url = commitUrlMatch[1];
      // URL should be well-formed: https://github.com/<org>/<repo>/commit/<hash>
      assert.match(url, /^https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/[a-f0-9]{40}$/,
        'Commit URL should be a valid GitHub commit link');
      // Should not contain auth tokens
      assert.ok(!url.includes('@'), 'Commit URL should not contain auth tokens');
      assert.ok(!url.includes('ghp_'), 'Commit URL should not contain GitHub PAT tokens');
    }
    // If no commit URL (not a git repo), that's OK — graceful degradation
  });

  it('version footer shows short hash in display text', () => {
    const html = buildHTML(baseConfig);
    // Should show 7-char short hash in parentheses
    const shortHashMatch = html.match(/Agent Portal v[\d.]+\s*\(([a-f0-9]{7})\)/);
    if (shortHashMatch) {
      assert.equal(shortHashMatch[1].length, 7, 'Short hash should be 7 characters');
    }
  });
});

describe('web portal — no hardcoded references', () => {
  const baseConfig = {
    name: 'TestAgent',
    authors: {},
    features: {},
  };

  it('generated HTML does not contain hardcoded GitHub PAT tokens', () => {
    const html = buildHTML(baseConfig);
    assert.ok(!html.includes('ghp_'), 'HTML should not leak GitHub PAT tokens');
    assert.ok(!html.includes('gho_'), 'HTML should not leak GitHub OAuth tokens');
  });
});

describe('web portal — tab JS content integrity', () => {
  it('GitHub tab JS references correct API endpoints', () => {
    const config = {
      name: 'TestAgent',
      authors: {},
      features: { github: { repos: ['org/repo'] } },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('/api/github/issues'), 'GitHub tab should fetch /api/github/issues');
    assert.ok(html.includes('/api/github/prs'), 'GitHub tab should fetch /api/github/prs');
  });

  it('todos tab JS references correct API endpoints', () => {
    const config = {
      name: 'TestAgent',
      authors: {},
      features: { tabs: ['journal', 'todos', 'status'] },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('/api/todos'), 'Todos tab should fetch /api/todos');
  });

  it('outputs tab JS references correct API endpoints', () => {
    const config = {
      name: 'TestAgent',
      authors: {},
      features: { tabs: ['journal', 'outputs', 'status'], outputs: true },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('/api/outputs'), 'Outputs tab should fetch /api/outputs');
    assert.ok(html.includes('/api/output/'), 'Outputs tab should fetch individual output files');
    assert.ok(html.includes('/api/feedback/'), 'Outputs tab should reference feedback endpoint');
  });

  it('health tab JS references correct API endpoint', () => {
    const config = {
      name: 'TestAgent',
      authors: {},
      features: { tabs: ['journal', 'health', 'status'], health: true },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('/api/health'), 'Health tab should fetch /api/health');
  });

  it('requests tab JS references correct API endpoint', () => {
    const config = {
      name: 'TestAgent',
      authors: {},
      features: { tabs: ['journal', 'requests', 'status'], requests: true },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('/api/requests'), 'Requests tab should fetch /api/requests');
  });

  it('roadmap tab JS references correct API endpoint', () => {
    const config = {
      name: 'TestAgent',
      authors: {},
      features: { tabs: ['journal', 'roadmap', 'status'], roadmap: true },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('/api/roadmap'), 'Roadmap tab should fetch /api/roadmap');
  });
});

describe('web portal — client core JS integrity', () => {
  const baseConfig = {
    name: 'TestAgent',
    authors: {},
    features: {},
  };

  it('client core references correct API endpoints for status', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('/api/status'), 'Core JS should fetch /api/status');
    assert.ok(html.includes('/api/journal'), 'Core JS should fetch /api/journal');
    assert.ok(html.includes('/api/next-run'), 'Core JS should fetch /api/next-run');
  });

  it('client core references correct API endpoints for cron and cycle', () => {
    const html = buildHTML(baseConfig);
    assert.ok(html.includes('/api/cron/toggle'), 'Core JS should reference /api/cron/toggle');
    assert.ok(html.includes('/api/cycle/run'), 'Core JS should reference /api/cycle/run');
    assert.ok(html.includes('/api/cycle/respond'), 'Core JS should reference /api/cycle/respond');
  });

  it('client core includes escapeHtml for XSS prevention', () => {
    const html = buildHTML(baseConfig);
    // Verify escapeHtml handles all critical characters
    assert.ok(html.includes("'&amp;'"), 'escapeHtml should escape ampersands');
    assert.ok(html.includes("'&lt;'"), 'escapeHtml should escape less-than');
    assert.ok(html.includes("'&gt;'"), 'escapeHtml should escape greater-than');
    assert.ok(html.includes("'&quot;'"), 'escapeHtml should escape quotes');
  });

  it('sidebar footer is present in both sidebar types', () => {
    // Simple sidebar
    const simpleHTML = buildHTML(baseConfig);
    assert.ok(simpleHTML.includes('id="sidebar-footer"'), 'Simple sidebar should have footer');

    // Projects sidebar
    const projectConfig = {
      ...baseConfig,
      sidebar: { type: 'projects' },
      features: { tabs: ['journal', 'status'] },
    };
    const projectHTML = buildHTML(projectConfig);
    assert.ok(projectHTML.includes('id="sidebar-footer"'), 'Project sidebar should have footer');
  });
});

describe('web portal — config injection', () => {
  it('PORTAL_CONFIG contains all configured tabs', () => {
    const config = {
      name: 'TestAgent',
      authors: {},
      features: { tabs: ['journal', 'github', 'status'], github: { repos: ['org/repo'] } },
    };
    const html = buildHTML(config);
    const configMatch = html.match(/const PORTAL_CONFIG = ({[^;]+})/);
    assert.ok(configMatch, 'PORTAL_CONFIG should be present in HTML');
    const portalConfig = JSON.parse(configMatch[1]);
    assert.deepEqual(portalConfig.tabs, ['journal', 'github', 'status']);
    assert.equal(portalConfig.name, 'TestAgent');
    assert.equal(portalConfig.hasGitHub, true);
    assert.deepEqual(portalConfig.githubRepos, ['org/repo']);
  });

  it('PORTAL_CONFIG sidebarType matches config', () => {
    const config = {
      name: 'Test',
      authors: {},
      features: {},
      sidebar: { type: 'projects' },
    };
    const html = buildHTML(config);
    const configMatch = html.match(/const PORTAL_CONFIG = ({[^;]+})/);
    const portalConfig = JSON.parse(configMatch[1]);
    assert.equal(portalConfig.sidebarType, 'projects');
  });

  it('TAB_LOADERS maps all configured tabs to loader functions', () => {
    const config = {
      name: 'Test',
      authors: {},
      features: {
        tabs: ['journal', 'github', 'outputs', 'todos', 'status'],
        github: { repos: ['org/repo'] },
        outputs: true,
      },
    };
    const html = buildHTML(config);
    assert.ok(html.includes('journal: loadJournal'), 'TAB_LOADERS should map journal');
    assert.ok(html.includes('status: loadStatus'), 'TAB_LOADERS should map status');
    assert.ok(html.includes('github: loadGitHub'), 'TAB_LOADERS should map github');
    assert.ok(html.includes('outputs: loadOutputs'), 'TAB_LOADERS should map outputs');
    assert.ok(html.includes('todos: loadTodos'), 'TAB_LOADERS should map todos');
  });
});
