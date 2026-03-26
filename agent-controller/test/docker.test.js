const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { composeArgs, streamLogsArgs, execArgs, cycleArgs } = require('../lib/docker');

const testAgent = {
  name: 'test-agent',
  deployment: 'sandcat',
};

describe('docker command construction', () => {
  it('composeArgs returns -f flag for sandcat deployment', () => {
    const args = composeArgs('test-agent', 'sandcat');
    assert.equal(args[0], '-f');
    assert.ok(args[1].includes('sandcat-stacks/test-agent/docker-compose.yml'));
  });

  it('composeArgs returns empty for non-sandcat', () => {
    const args = composeArgs('test-agent', 'simple');
    assert.equal(args.length, 0);
  });

  it('streamLogsArgs includes --follow', () => {
    const args = streamLogsArgs(testAgent, null, null);
    assert.ok(args.includes('--follow'));
    assert.ok(args.includes('logs'));
  });

  it('streamLogsArgs includes service and tail', () => {
    const args = streamLogsArgs(testAgent, 'agent', '50');
    assert.ok(args.includes('agent'));
    assert.ok(args.includes('--tail'));
    assert.ok(args.includes('50'));
  });

  it('execArgs passes command as array (no shell interpolation)', () => {
    const args = execArgs(testAgent, ['echo', 'hello world']);
    assert.ok(args.includes('exec'));
    assert.ok(args.includes('-T'));
    assert.ok(args.includes('agent'));
    // Command should be the last elements
    const echoIdx = args.indexOf('echo');
    assert.ok(echoIdx > 0);
    assert.equal(args[echoIdx + 1], 'hello world');
  });

  it('cycleArgs runs bash scripts/wake.sh', () => {
    const args = cycleArgs(testAgent);
    assert.ok(args.includes('exec'));
    assert.ok(args.includes('bash'));
    assert.ok(args.includes('scripts/wake.sh'));
  });
});
