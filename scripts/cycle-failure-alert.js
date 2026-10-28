const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function failureRun(events, exitCode) {
  const cycles = [];
  let current = null;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'cycle_start') {
      if (current && (current.failed || current.complete)) cycles.push(current);
      current = event.summary === 'Scheduled wake' ? { started: event.ts, failed: false } : null;
    } else if (current) {
      if (event.type === 'error' && /^Harness exited with code \d+ after \d+ attempt\(s\)$/.test(event.summary)) {
        current.failed = true;
        current.firstFailure ??= event.ts;
      }
      if (event.type === 'cycle_end') current.complete = true;
    }
  }
  if (!current) throw new Error('No current scheduled cycle');
  current.failed = exitCode !== 0;
  cycles.push(current);
  const failures = [];
  for (const cycle of cycles.reverse()) {
    if (!cycle.failed) break;
    failures.unshift(cycle);
  }
  return { count: failures.length, firstFailure: failures[0]?.firstFailure || failures[0]?.started };
}

function notifyCycleFailures({ agentDir, dataDir, agentName, cycleLog, exitCode, now = new Date() }) {
  if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  const stateFile = path.join(agentDir, dataDir, 'logs', 'cycle-failure-alert.json');
  let state = null;
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (saved && typeof saved.firstFailure === 'string' && Number.isFinite(Date.parse(saved.notifiedAt))) state = saved;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  if (exitCode === 0 && !state) return;
  let run;
  if (exitCode !== 0) {
    const events = fs.readFileSync(path.join(agentDir, dataDir, 'logs', 'events.jsonl'), 'utf8')
      .split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    run = failureRun(events, exitCode);
    if (run.count < 3) return;
    if (state?.firstFailure === run.firstFailure && now.getTime() - Date.parse(state.notifiedAt) < 24 * 60 * 60 * 1000) return;
  }
  let message = `${agentName} is running again after its scheduled cycle failures.`;
  if (run) {
    let firstLine = 'No transcript available.';
    try { firstLine = fs.readFileSync(cycleLog, 'utf8').split(/\r?\n/, 1)[0].slice(0, 300) || firstLine; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    message = `${agentName}: ${run.count} consecutive scheduled cycles failed. First failure: ${run.firstFailure}.\n${firstLine}`;
  }
  const result = spawnSync('bash', [path.join(__dirname, 'notify.sh'), message], { stdio: 'inherit', timeout: 20000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cycle notification failed (${result.status})`);
  if (run) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify({ firstFailure: run.firstFailure, notifiedAt: now.toISOString() }) + '\n');
    fs.renameSync(`${stateFile}.tmp`, stateFile);
  } else fs.unlinkSync(stateFile);
}

if (require.main === module) {
  const [agentDir, dataDir, agentName, cycleLog, result] = process.argv.slice(2);
  const exitCode = Number(result);
  if (!agentDir || !dataDir || !agentName || !cycleLog || !/^\d+$/.test(result || '') || !Number.isSafeInteger(exitCode)) {
    console.error('Usage: cycle-failure-alert.js <agent-dir> <data-dir> <agent-name> <cycle-log> <harness-exit>');
    process.exitCode = 1;
  } else {
    try { notifyCycleFailures({ agentDir, dataDir, agentName, cycleLog, exitCode }); }
    catch (error) { console.error(`Cycle failure alert: ${error.message}`); process.exitCode = 1; }
  }
}

module.exports = { failureRun, notifyCycleFailures };
