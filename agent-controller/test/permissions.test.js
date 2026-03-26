const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkPermission, listVisibleAgents } = require('../lib/permissions');

function makeConfig() {
  return {
    agents: {
      'agent-coder': {
        name: 'agent-coder',
        dir: '/tmp/agents/agent-coder',
        controllable: true,
        deployment: 'sandcat',
        permissions: {
          agentbox: new Set(['rebuild', 'restart', 'stop', 'start', 'logs', 'status', 'exec', 'cycle']),
          'agent-pm': new Set(['restart', 'logs', 'status']),
        },
      },
      bobbo: {
        name: 'bobbo',
        dir: '/tmp/agents/bobbo-agent',
        controllable: false,
        deployment: 'sandcat',
        permissions: {},
      },
      'agent-pm': {
        name: 'agent-pm',
        dir: '/tmp/agents/agent-pm',
        controllable: false,
        deployment: 'sandcat',
        permissions: {},
      },
    },
  };
}

describe('permissions', () => {
  const config = makeConfig();

  it('allows caller with the right permission', () => {
    const result = checkPermission(config, 'agentbox', 'agent-coder', 'restart');
    assert.equal(result.allowed, true);
  });

  it('allows all permissions for fully-authorized caller', () => {
    for (const op of ['rebuild', 'restart', 'stop', 'start', 'logs', 'status', 'exec', 'cycle']) {
      const result = checkPermission(config, 'agentbox', 'agent-coder', op);
      assert.equal(result.allowed, true, `agentbox should be allowed to ${op}`);
    }
  });

  it('denies permission not in callers list', () => {
    const result = checkPermission(config, 'agent-pm', 'agent-coder', 'rebuild');
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 403);
    assert.match(result.reason, /cannot 'rebuild'/);
  });

  it('denies all operations on controllable: false agent', () => {
    const result = checkPermission(config, 'agentbox', 'bobbo', 'status');
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 403);
    assert.match(result.reason, /not controllable/);
  });

  it('returns 404 for unknown agent name', () => {
    const result = checkPermission(config, 'agentbox', 'nonexistent', 'status');
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 404);
    assert.match(result.reason, /Unknown agent/);
  });

  it('denies caller not listed in agent permissions', () => {
    const result = checkPermission(config, 'unknown-caller', 'agent-coder', 'status');
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 403);
    assert.match(result.reason, /no permissions/);
  });

  it('denies exec for caller with only restart/logs/status', () => {
    const result = checkPermission(config, 'agent-pm', 'agent-coder', 'exec');
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 403);
  });

  it('allows agent-pm to restart agent-coder', () => {
    const result = checkPermission(config, 'agent-pm', 'agent-coder', 'restart');
    assert.equal(result.allowed, true);
  });

  it('denies caller with exec on agent A accessing agent B', () => {
    // agentbox has exec on agent-coder, but bobbo is not controllable
    const result = checkPermission(config, 'agentbox', 'bobbo', 'exec');
    assert.equal(result.allowed, false);
  });

  it('denies operations on agent-pm (not controllable)', () => {
    for (const op of ['restart', 'logs', 'status', 'exec', 'rebuild']) {
      const result = checkPermission(config, 'agentbox', 'agent-pm', op);
      assert.equal(result.allowed, false, `should deny ${op} on agent-pm`);
      assert.match(result.reason, /not controllable/);
    }
  });
});

describe('listVisibleAgents', () => {
  const config = makeConfig();

  it('returns only controllable agents where caller has permissions', () => {
    const visible = listVisibleAgents(config, 'agentbox');
    assert.equal(visible.length, 1);
    assert.equal(visible[0].name, 'agent-coder');
    assert.ok(visible[0].permissions.includes('restart'));
  });

  it('returns empty list for caller with no permissions anywhere', () => {
    const visible = listVisibleAgents(config, 'unknown-caller');
    assert.equal(visible.length, 0);
  });

  it('returns correct permissions for agent-pm caller', () => {
    const visible = listVisibleAgents(config, 'agent-pm');
    assert.equal(visible.length, 1);
    assert.equal(visible[0].name, 'agent-coder');
    assert.deepEqual(visible[0].permissions.sort(), ['logs', 'restart', 'status']);
  });

  it('excludes non-controllable agents even if permissions are defined', () => {
    const customConfig = {
      agents: {
        locked: {
          name: 'locked',
          dir: '/tmp/locked',
          controllable: false,
          permissions: { agentbox: new Set(['status']) },
        },
      },
    };
    const visible = listVisibleAgents(customConfig, 'agentbox');
    assert.equal(visible.length, 0);
  });
});
