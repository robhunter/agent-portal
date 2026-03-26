const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { composeArgs, streamLogsArgs, execArgs, cycleArgs, rebuildScript, createJob, getJob } = require('../lib/docker');

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

  it('rebuildScript returns sandcat script for sandcat deployment', () => {
    const config = { frameworkDir: '/tmp/framework' };
    const agent = { ...testAgent, dir: '/tmp/agents/test-agent' };
    const { command, args } = rebuildScript(config, agent);
    assert.equal(command, 'bash');
    assert.ok(args[0].includes('docker-compose-create.sh'));
    assert.equal(args[1], '/tmp/agents/test-agent');
  });

  it('rebuildScript returns simple script for simple deployment', () => {
    const config = { frameworkDir: '/tmp/framework' };
    const agent = { name: 'test', deployment: 'simple', dir: '/tmp/agents/test' };
    const { command, args } = rebuildScript(config, agent);
    assert.ok(args[0].includes('docker-create.sh'));
  });

  it('createJob returns unique job IDs', () => {
    const job1 = createJob('agent-a');
    const job2 = createJob('agent-b');
    assert.notEqual(job1.id, job2.id);
    assert.equal(job1.status, 'running');
    assert.equal(job1.agent, 'agent-a');
  });

  it('getJob returns job by ID', () => {
    const job = createJob('agent-c');
    const found = getJob(job.id);
    assert.equal(found.id, job.id);
  });

  it('getJob returns null for unknown ID', () => {
    assert.equal(getJob('rb-nonexistent'), null);
  });
});
