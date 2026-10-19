const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scripts = path.resolve(__dirname, '../scripts');

function run(name, args, inherited) {
  const env = { ...process.env, DATA_DIR: inherited };
  if (inherited === undefined) delete env.DATA_DIR;
  const result = spawnSync('bash', [path.join(scripts, name + '.sh'), ...args], {
    env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, `${name}: ${result.error || result.stderr}`);
  return result.stdout;
}

describe('utilities address the target agent data layout', () => {
  const cases = [
    { name: 'configured data directory', config: { dataDir: 'target data' }, inherited: '.', expected: 'target data' },
    { name: 'explicit root layout', config: { dataDir: '.' }, inherited: 'caller', expected: '.' },
    { name: 'default root layout', config: {}, inherited: 'caller', expected: '.' },
    { name: 'environment fallback without config', inherited: 'caller', expected: 'caller' },
    { name: 'root fallback without config or environment', expected: '.' },
  ];

  for (const scenario of cases) {
    it(scenario.name, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'target-layout-'));
      try {
        if (scenario.config) fs.writeFileSync(path.join(dir, 'portal.config.json'), JSON.stringify(scenario.config));
        fs.writeFileSync(path.join(dir, 'agent.yaml'), 'name: layout-test\ncron:\n  schedule: "0 * * * *"\n');
        const roots = [...new Set(['.', 'caller', 'target data', scenario.expected])];
        const todos = '## Todos\n\n- [x] Completed task\n- [ ] Open task\n';
        for (const root of roots) {
          fs.mkdirSync(path.join(dir, root, 'logs'), { recursive: true });
          fs.writeFileSync(path.join(dir, root, 'human_todos.md'), todos);
          const events = root === scenario.expected ? 2 : 5;
          fs.writeFileSync(path.join(dir, root, 'logs/events.jsonl'),
            '{"type":"cycle_start","ts":"2026-01-01T00:00:00Z"}\n'.repeat(events));
        }
        const target = path.join(dir, scenario.expected);
        const args = [dir];
        run('log-event', [...args, 'work', 'target event'], scenario.inherited);
        const event = JSON.parse(fs.readFileSync(path.join(target, 'logs/events.jsonl'), 'utf8').trim().split('\n').at(-1));
        assert.equal(event.summary, 'target event');
        run('log-journal', [...args, 'layout.md', 'test', 'cycle', 'target entry'], scenario.inherited);
        assert.match(fs.readFileSync(path.join(target, 'journals/layout.md'), 'utf8'), /target entry/);
        run('clear-done-todos', args, scenario.inherited);
        assert.doesNotMatch(fs.readFileSync(path.join(target, 'human_todos.md'), 'utf8'), /Completed task/);
        const consolidation = run('consolidate-memory', args, scenario.inherited);
        assert.match(consolidation, /2 cycles since last consolidation/);
        const cron = run('cron-setup', args, scenario.inherited);
        assert.ok(cron.includes(`>> ${scenario.expected}/logs/cycles/cron-wake.log`), cron);
        // Stop startup after its first log, before PID cleanup or service launch.
        const stop = path.join(dir, 'stop-startup.sh');
        fs.writeFileSync(stop, 'trap \'case "$BASH_COMMAND" in "for pidfile in "*) exit 0;; esac\' DEBUG\n');
        const startupEnv = { ...process.env, DATA_DIR: scenario.inherited, BASH_ENV: stop };
        if (scenario.inherited === undefined) delete startupEnv.DATA_DIR;
        const startup = spawnSync('bash', [path.join(scripts, 'start.sh'), dir], {
          env: startupEnv, encoding: 'utf8', timeout: 15000,
        });
        assert.equal(startup.status, 0, `${startup.error || startup.stderr}`);
        assert.match(fs.readFileSync(path.join(target, 'logs/supervisor.log'), 'utf8'), /Starting agent 'layout-test'/);
        for (const root of roots.filter(root => root !== scenario.expected)) {
          const other = path.join(dir, root);
          assert.equal(fs.readFileSync(path.join(other, 'human_todos.md'), 'utf8'), todos);
          assert.equal(fs.readFileSync(path.join(other, 'logs/events.jsonl'), 'utf8').trim().split('\n').length, 5);
          assert.equal(fs.existsSync(path.join(other, 'journals/layout.md')), false);
          assert.equal(fs.existsSync(path.join(other, 'logs/supervisor.log')), false);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  for (const launcher of ['shell', 'node']) {
    for (const scenario of cases) {
      it(`${launcher} publisher: ${scenario.name}`, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'target-publish-'));
        try {
          if (scenario.config) fs.writeFileSync(path.join(dir, 'portal.config.json'), JSON.stringify(scenario.config));
          const roots = [...new Set(['.', 'caller', 'target data', scenario.expected])];
          for (const root of roots) {
            fs.mkdirSync(path.join(dir, root, 'config'), { recursive: true });
            fs.writeFileSync(path.join(dir, root, 'config/sources.yaml'), root !== scenario.expected ? 'sources: []\n' :
              'sources:\n  - id: source\n    status: approved\n    hosts: [example.com]\n    url: https://example.com\n');
          }
          const draft = path.join(dir, 'draft.yaml');
          fs.writeFileSync(draft, 'id: layout-item\ntitle: Layout item\ncategory: books\nstatus: linked\nsource: source\nsource_url: https://example.com/item\n');
          const command = launcher === 'shell' ? 'bash' : process.execPath;
          const args = launcher === 'shell' ? [path.join(scripts, 'publish-content.sh'), dir, draft] :
            [path.join(scripts, 'publish-content.js'), draft, '--agent-dir', dir];
          const env = { ...process.env, DATA_DIR: scenario.inherited };
          if (scenario.inherited === undefined) delete env.DATA_DIR;
          const options = { env, encoding: 'utf8', timeout: 15000 };
          const result = spawnSync(command, [...args, '--skip-fetch', '--skip-extraction'], options);
          assert.equal(result.status, 0, result.stderr);
          assert.equal(fs.existsSync(path.join(dir, scenario.expected, 'content/items/layout-item.yaml')), true);
          assert.equal(fs.existsSync(draft), false);
          fs.writeFileSync(draft, 'id: rejected-item\ntitle: Rejected item\ncategory: books\nstatus: linked\nsource: source\nsource_url: https://unapproved.example/item\n');
          const rejection = spawnSync(command, [...args, '--skip-fetch', '--skip-extraction'], options);
          assert.equal(rejection.status, 1, rejection.stderr);
          const rejected = path.join(dir, scenario.expected, 'content/rejected/rejected-item.yaml');
          assert.match(fs.readFileSync(rejected, 'utf8'), /_validation:/);
          for (const root of roots.filter(root => root !== scenario.expected)) {
            assert.equal(fs.existsSync(path.join(dir, root, 'content')), false);
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
});
