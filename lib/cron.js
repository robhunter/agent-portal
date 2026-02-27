// cron.js — Cron schedule parsing and next-run calculation
// No external dependencies

const fs = require('fs');
const { execSync } = require('child_process');

function isCronRunning() {
  try {
    execSync('pgrep -x cron', { encoding: 'utf-8', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function isCycleLocked(lockFile) {
  if (!lockFile) return false;
  try {
    execSync(`flock -n ${lockFile} echo ok`, { timeout: 3000, stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function expandField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      let start = min;
      let end = max;
      if (stepMatch[1] !== '*') {
        const rm = stepMatch[1].match(/^(\d+)(?:-(\d+))?$/);
        if (rm) { start = parseInt(rm[1], 10); if (rm[2] !== undefined) end = parseInt(rm[2], 10); }
      }
      for (let i = start; i <= end; i += step) values.add(i);
    } else if (rangeMatch) {
      for (let i = parseInt(rangeMatch[1], 10); i <= parseInt(rangeMatch[2], 10); i++) values.add(i);
    } else if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }
  return values;
}

function getNextRun(cronFile) {
  let cronContent;
  try {
    cronContent = fs.readFileSync(cronFile, 'utf-8');
  } catch {
    return { next: null, cron: null, error: 'Cron not installed', installed: false, daemonRunning: false };
  }

  const daemonRunning = isCronRunning();
  if (!daemonRunning) {
    const wakeLine = cronContent.split('\n').find(l => l.includes('wake.sh') && !l.startsWith('#'));
    const cronExpr = wakeLine ? wakeLine.trim().split(/\s+/).slice(0, 5).join(' ') : null;
    const hasActive = cronContent.split('\n').some(l => l.includes('wake.sh') && !l.startsWith('#'));
    return { next: null, cron: cronExpr, error: 'Cron daemon not running', installed: true, daemonRunning: false, enabled: hasActive };
  }

  const wakeLine = cronContent.split('\n').find(l => l.includes('wake.sh') && !l.startsWith('#'));
  if (!wakeLine) {
    const commented = cronContent.split('\n').find(l => l.startsWith('#') && l.includes('wake.sh'));
    if (commented) {
      return { next: null, cron: null, error: 'Cron disabled', installed: true, daemonRunning: true, enabled: false };
    }
    return { next: null, cron: null, error: 'No wake.sh entry in cron', installed: true, daemonRunning: true, enabled: false };
  }

  const parts = wakeLine.trim().split(/\s+/);
  const [minField, hourField, domField, monField, dowField] = parts;
  const cronExpr = [minField, hourField, domField, monField, dowField].join(' ');

  const validMins = expandField(minField, 0, 59);
  const validHours = expandField(hourField, 0, 23);
  const validDoms = expandField(domField, 1, 31);
  const validMons = expandField(monField, 1, 12);
  const validDows = expandField(dowField, 0, 6);

  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const limit = 7 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    const m = candidate.getMinutes();
    const h = candidate.getHours();
    const dom = candidate.getDate();
    const mon = candidate.getMonth() + 1;
    const dow = candidate.getDay();

    if (validMins.has(m) && validHours.has(h) && validDoms.has(dom) &&
        validMons.has(mon) && validDows.has(dow)) {
      return { next: candidate.toISOString(), cron: cronExpr, error: null, installed: true, daemonRunning: true, enabled: true };
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return { next: null, cron: cronExpr, error: 'No run found in next 7 days', installed: true, daemonRunning: true, enabled: true };
}

module.exports = { expandField, getNextRun, isCronRunning, isCycleLocked };
