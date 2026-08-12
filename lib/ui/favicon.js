// favicon.js — the browser-tab icon, driven by whether the agent is running.
//
// Four states, because the data supports four and collapsing them would lie:
//
//   running    filled green disc     a cycle holds the lock right now
//   scheduled  clock                 cron is installed AND the daemon is alive,
//                                    so it WILL fire — just not this second
//   broken     red ring              cron is installed and the daemon is DEAD.
//                                    Nothing will fire. This looks identical to
//                                    "scheduled" in every other part of the UI,
//                                    which is exactly why it earns its own icon
//                                    — a clock here would promise a run that is
//                                    never coming.
//   idle       grey ring             no cron installed; the agent is off on
//                                    purpose. Hollow, so "off" reads as absence.
//
// Drawn for 16x16, which is the only size that matters — a tab favicon is never
// shown larger. Everything is sized in a 32-unit viewBox and then halved by the
// browser, so strokes are deliberately heavy (3 units ≈ 1.5 device px) and the
// clock's hands sit at 10:10, the angle that stays legible when the glyph is
// smaller than the text beside it.

const RING = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<circle cx="16" cy="16" r="12" fill="none" stroke="${color}" stroke-width="4"/></svg>`;

const FAVICONS = {
  // Filled, with a slightly darker rim so the disc keeps an edge against a
  // light tab strip and does not dissolve into a green smudge.
  running:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="16" r="13" fill="#2e7d32"/>` +
    `<circle cx="16" cy="16" r="13" fill="none" stroke="#1b5e20" stroke-width="2"/></svg>`,

  scheduled:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<circle cx="16" cy="17" r="11" fill="none" stroke="#b26a00" stroke-width="3.5"/>` +
    // Stem and crown, so it reads as a stopwatch rather than a letter O.
    `<rect x="13" y="1.5" width="6" height="3.5" rx="1.5" fill="#b26a00"/>` +
    `<rect x="14.75" y="4" width="2.5" height="3" fill="#b26a00"/>` +
    // Hands at 10:10 — the classic watch-face angle, and the one pair of
    // directions that never overlaps the stem or each other at this size.
    `<path d="M16 17 L16 10 M16 17 L21 20" fill="none" stroke="#b26a00" ` +
    `stroke-width="3" stroke-linecap="round"/></svg>`,

  broken: RING('#c62828'),
  idle: RING('#9e9e9e'),
};

/**
 * Pick the state from an /api/status payload.
 *
 * Exported and pure so the branch order is testable without a browser: running
 * wins over everything (a cycle running with a dead cron daemon is still
 * running), and a dead daemon beats "scheduled" so the promise is never made.
 */
function faviconState(status) {
  if (!status) return 'idle';
  if (status.cycleRunning) return 'running';
  const cron = (status.services && status.services.cron) || {};
  if (!cron.installed) return 'idle';
  return cron.daemonRunning ? 'scheduled' : 'broken';
}

/** Client-side half: the same table, plus the swap on each status poll. */
function getFaviconJS() {
  return `
var FAVICONS = ${JSON.stringify(FAVICONS)};

function faviconState(status) {
  if (!status) return 'idle';
  if (status.cycleRunning) return 'running';
  var cron = (status.services && status.services.cron) || {};
  if (!cron.installed) return 'idle';
  return cron.daemonRunning ? 'scheduled' : 'broken';
}

var _faviconState = null;
function setFavicon(status) {
  var state = faviconState(status);
  // Reassigning href re-decodes the image in some browsers and makes the tab
  // icon visibly flicker every poll. Only touch the DOM on a real change.
  if (state === _faviconState) return;
  var el = document.getElementById('favicon');
  if (!el) return;
  el.href = 'data:image/svg+xml,' + encodeURIComponent(FAVICONS[state]);
  el.title = state;
  _faviconState = state;
}
`;
}

module.exports = { FAVICONS, faviconState, getFaviconJS };
