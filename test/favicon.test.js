const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { FAVICONS, faviconState, getFaviconJS } = require('../lib/ui/favicon');

const status = (cycleRunning, cron, extra) => ({
  cycleRunning,
  services: cron === undefined ? {} : { cron },
  ...extra,
});

describe('faviconState', () => {
  it('running wins over cron state', () => {
    assert.equal(faviconState(status(true, { installed: true, daemonRunning: true })), 'running');
    assert.equal(faviconState(status(true, { installed: false })), 'running');
  });

  it('a running cycle with a DEAD daemon is still running', () => {
    // The lock is the ground truth for "is it working right now". Cron only
    // says whether another one will start later.
    assert.equal(faviconState(status(true, { installed: true, daemonRunning: false })), 'running');
  });

  it('installed and alive, idle right now → scheduled', () => {
    assert.equal(faviconState(status(false, { installed: true, daemonRunning: true })), 'scheduled');
  });

  it('installed but the daemon is dead → broken, never scheduled', () => {
    // The whole reason this state exists: a clock would promise a run that is
    // not coming. Nothing else in the UI distinguishes these two.
    assert.equal(faviconState(status(false, { installed: true, daemonRunning: false })), 'broken');
  });

  it('no cron installed → idle', () => {
    assert.equal(faviconState(status(false, { installed: false, daemonRunning: false })), 'idle');
  });

  it('installed but switched off → idle, not scheduled', () => {
    // The bug this state exists for: toggling cron off comments the wake line
    // out, so the file is still installed and the daemon is still alive. Reading
    // `installed` alone left a stopwatch on the tab of an agent that was never
    // going to run.
    assert.equal(
      faviconState(status(false, { installed: true, daemonRunning: true, enabled: false })), 'idle');
  });

  it('off on purpose outranks a dead daemon and a failed cycle', () => {
    const off = { installed: true, daemonRunning: false, enabled: false };
    assert.equal(faviconState(status(false, off)), 'idle');
    assert.equal(faviconState(status(false, off, { lastCycleErrored: true })), 'idle');
  });

  it('a payload with no `enabled` field keeps the old behaviour', () => {
    // An older portal serving /api/status omits the field entirely. Treating
    // undefined as "off" would turn every one of those agents grey.
    assert.equal(faviconState(status(false, { installed: true, daemonRunning: true })), 'scheduled');
  });

  it('cron live but the last cycle errored → degraded', () => {
    assert.equal(
      faviconState(status(false, { installed: true, daemonRunning: true, enabled: true },
        { lastCycleErrored: true })), 'degraded');
  });

  it('a dead daemon outranks a failed cycle', () => {
    // Both are true at once on a broken host, and "nothing will fire" is the
    // more useful thing to say than "the last one did not land".
    assert.equal(
      faviconState(status(false, { installed: true, daemonRunning: false, enabled: true },
        { lastCycleErrored: true })), 'broken');
  });

  it('a running cycle outranks a failed previous one', () => {
    assert.equal(
      faviconState(status(true, { installed: true, daemonRunning: true, enabled: true },
        { lastCycleErrored: true })), 'running');
  });

  it('an unknown or clean cycle history is not degraded', () => {
    const cron = { installed: true, daemonRunning: true, enabled: true };
    assert.equal(faviconState(status(false, cron, { lastCycleErrored: null })), 'scheduled');
    assert.equal(faviconState(status(false, cron, { lastCycleErrored: false })), 'scheduled');
  });

  it('missing or malformed payloads degrade to idle, never throw', () => {
    assert.equal(faviconState(status(false)), 'idle');       // no cron key
    assert.equal(faviconState({ cycleRunning: false }), 'idle');  // no services
    assert.equal(faviconState({}), 'idle');
    assert.equal(faviconState(null), 'idle');
    assert.equal(faviconState(undefined), 'idle');
  });
});

describe('FAVICONS', () => {
  it('defines exactly the five states faviconState can return', () => {
    assert.deepEqual(Object.keys(FAVICONS).sort(),
      ['broken', 'degraded', 'idle', 'running', 'scheduled']);
  });

  it('every icon is a well-formed standalone SVG', () => {
    for (const [name, svg] of Object.entries(FAVICONS)) {
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, name);
      assert.match(svg, /<\/svg>$/, name);
      assert.match(svg, /viewBox="0 0 32 32"/, name);
    }
  });

  it('all five are visually distinct', () => {
    // idle and broken are the same ring shape and differ only by colour, which
    // makes them the easy pair to break with a careless refactor.
    assert.equal(new Set(Object.values(FAVICONS)).size, 5);
    assert.notEqual(FAVICONS.idle, FAVICONS.broken);
  });

  it('the two ring states carry their intended colours', () => {
    assert.match(FAVICONS.idle, /stroke="#9e9e9e"/);
    assert.match(FAVICONS.broken, /stroke="#c62828"/);
  });

  it('degraded is Flenderson\'s yellow, and not a second amber round thing', () => {
    // The colour is the point: the dashboard and the tab have to agree on what
    // yellow means. The shape is the other point — at 16px, "amber ring" and
    // "amber stopwatch" are the same picture.
    assert.match(FAVICONS.degraded, /fill="#d29922"/);
    assert.doesNotMatch(FAVICONS.degraded, /<circle/);
  });

  it('survives URI encoding for a data: href', () => {
    for (const [name, svg] of Object.entries(FAVICONS)) {
      const uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
      assert.equal(decodeURIComponent(uri.slice('data:image/svg+xml,'.length)), svg, name);
    }
  });
});

describe('getFaviconJS', () => {
  it('emits a client copy of the same table', () => {
    const js = getFaviconJS();
    assert.match(js, /function setFavicon\(/);
    assert.match(js, /function faviconState\(/);
    // The client gets the icons by serialising the server's object, so the two
    // halves cannot drift apart.
    assert.ok(js.includes(JSON.stringify(FAVICONS)));
  });

  it('the emitted client state machine agrees with the server one', () => {
    // Evaluate the emitted source and run the same cases through it, so a
    // divergence between the two copies fails here rather than in a browser.
    const clientFaviconState = new Function(`${getFaviconJS()}; return faviconState;`)();
    const cases = [
      status(true, { installed: false }),
      status(false, { installed: true, daemonRunning: true }),
      status(false, { installed: true, daemonRunning: false }),
      status(false, { installed: false }),
      status(false, { installed: true, daemonRunning: true, enabled: false }),
      status(false, { installed: true, daemonRunning: true, enabled: true },
        { lastCycleErrored: true }),
      status(false, { installed: true, daemonRunning: false, enabled: false },
        { lastCycleErrored: true }),
      status(true, { installed: true, daemonRunning: true, enabled: true },
        { lastCycleErrored: true }),
      {}, null,
    ];
    for (const c of cases) {
      assert.equal(clientFaviconState(c), faviconState(c), JSON.stringify(c));
    }
  });
});
