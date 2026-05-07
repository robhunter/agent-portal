// cron-schedule.js — Convert between (intervalHours, anchorHour, anchorMinute) and cron expressions.
// Restricted to "every N hours" patterns where N divides 24, so the schedule cycles cleanly across day boundaries.

const VALID_INTERVALS = [1, 2, 3, 4, 6, 8, 12, 24];

function isValidInterval(n) {
  return VALID_INTERVALS.includes(n);
}

function generateHours(intervalHours, anchorHour) {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    if (((h - anchorHour) % intervalHours + intervalHours) % intervalHours === 0) {
      hours.push(h);
    }
  }
  return hours;
}

function cronFromInterval({ intervalHours, anchorHour, anchorMinute }) {
  if (!Number.isInteger(intervalHours) || !isValidInterval(intervalHours)) {
    throw new Error(`intervalHours must be one of ${VALID_INTERVALS.join(', ')}`);
  }
  if (!Number.isInteger(anchorHour) || anchorHour < 0 || anchorHour > 23) {
    throw new Error('anchorHour must be 0-23');
  }
  if (!Number.isInteger(anchorMinute) || anchorMinute < 0 || anchorMinute > 59) {
    throw new Error('anchorMinute must be 0-59');
  }
  const hours = generateHours(intervalHours, anchorHour);
  return `${anchorMinute} ${hours.join(',')} * * *`;
}

function intervalFromCron(cronExpr) {
  if (!cronExpr || typeof cronExpr !== 'string') return null;
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;

  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  if (!/^\d+$/.test(m)) return null;

  const anchorMinute = parseInt(m, 10);
  if (anchorMinute < 0 || anchorMinute > 59) return null;

  let hours;
  if (h === '*') {
    hours = Array.from({ length: 24 }, (_, i) => i);
  } else if (/^\d+(?:,\d+)*$/.test(h)) {
    hours = h.split(',').map(s => parseInt(s, 10));
    if (hours.some(x => x < 0 || x > 23)) return null;
    hours = [...new Set(hours)].sort((a, b) => a - b);
  } else if (/^\*\/\d+$/.test(h)) {
    const step = parseInt(h.slice(2), 10);
    if (!isValidInterval(step)) return null;
    hours = [];
    for (let hh = 0; hh < 24; hh += step) hours.push(hh);
  } else {
    return null;
  }

  if (hours.length === 0) return null;

  const anchorHour = hours[0];
  for (const N of VALID_INTERVALS) {
    const expected = generateHours(N, anchorHour);
    if (expected.length !== hours.length) continue;
    if (expected.every((x, i) => x === hours[i])) {
      return { intervalHours: N, anchorHour, anchorMinute };
    }
  }
  return null;
}

module.exports = { cronFromInterval, intervalFromCron, VALID_INTERVALS };
