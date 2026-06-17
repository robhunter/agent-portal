// routes/events.js — /api/events, /api/wins

const fs = require('fs');
const path = require('path');
const { sendJSON, readLastLines, dataPath } = require('../helpers');

function register(routes, config) {
  const logsDir = dataPath(config, 'logs');

  routes['GET /api/events'] = (req, res) => {
    const lines = readLastLines(path.join(logsDir, 'events.jsonl'), 50);
    const events = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch {}
    }
    sendJSON(res, 200, events);
  };

  routes['GET /api/events/timeseries'] = (req, res) => {
    const eventsPath = path.join(logsDir, 'events.jsonl');
    const days = 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Build day-keyed buckets for the last 30 days
    const buckets = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { cycles: 0, work: 0, errors: 0, idle: 0, totalDuration: 0, cycleEnds: 0 };
    }

    try {
      // Read last 3000 lines instead of entire file — covers ~30 days of typical activity
      const lines = readLastLines(eventsPath, 3000);
      if (lines.length > 0) {
        for (const line of lines) {
          try {
            const evt = JSON.parse(line);
            const evtDate = new Date(evt.ts);
            if (evtDate < cutoff) continue;
            const key = evtDate.toISOString().slice(0, 10);
            if (!buckets[key]) continue;
            if (evt.type === 'cycle_start') buckets[key].cycles++;
            else if (evt.type === 'work') buckets[key].work++;
            else if (evt.type === 'error') buckets[key].errors++;
            else if (evt.type === 'idle') buckets[key].idle++;
            if (evt.type === 'cycle_end' && evt.duration_m != null) {
              buckets[key].totalDuration += evt.duration_m;
              buckets[key].cycleEnds++;
            }
          } catch {}
        }
      }
    } catch {}

    // Convert to sorted array
    const series = Object.keys(buckets).sort().map(date => {
      const b = buckets[date];
      return {
        date,
        cycles: b.cycles,
        work: b.work,
        errors: b.errors,
        idle: b.idle,
        avgDuration: b.cycleEnds > 0 ? Math.round(b.totalDuration / b.cycleEnds) : 0,
      };
    });
    sendJSON(res, 200, { days, series });
  };

  routes['GET /api/wins'] = (req, res) => {
    const winsPath = path.join(logsDir, 'wins.jsonl');
    let allWins = [];
    try {
      const content = fs.readFileSync(winsPath, 'utf-8').trim();
      if (content) {
        const lines = content.split('\n');
        for (const line of lines) {
          try { allWins.push(JSON.parse(line)); } catch {}
        }
      }
    } catch {}
    // Filter by absolute instant, not by raw ISO string. wins.jsonl timestamps
    // arrive in mixed representations — shell `date` writes a local numeric
    // offset (e.g. -07:00, no fraction); Python isoformat writes +00:00 with
    // microseconds — so a lexicographic `w.ts >= <UTC-"Z" cutoff>` mis-filters
    // across the offset/format boundary: a win whose instant is within the
    // window but is logged in local evening sorts before the cutoff string and
    // is silently dropped. new Date() normalizes every ISO form to an instant,
    // matching the /api/journal and /api/projects filtering idiom.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recent = allWins.filter(w => new Date(w.ts) >= cutoff);
    sendJSON(res, 200, recent);
  };
}

module.exports = { register };
