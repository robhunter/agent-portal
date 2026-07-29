#!/bin/bash
# sandcat-wg-readiness.test.sh — Verify wg-client signals readiness only once the
# WireGuard tunnel has actually completed a handshake.
#
# Context: the compose healthcheck is `test -f /tmp/wg-ready`, and
# docker-compose-create.sh starts installing into the agent container the moment
# it passes. WireGuard's handshake is lazy, so signalling on configuration alone
# leaves a window where the rules exist but no packet has crossed the tunnel.
# Small fetches trigger the handshake and survive a retry; a large sustained
# transfer begun in that window stalls. That is the shape of the rebuild hang:
# apt and the 16KB nvm installer succeeded, the 28MB node tarball did not.
#
# WireGuard cannot run here, so we test the decision logic (the awk predicate
# over `wg show wg0 latest-handshakes`) and the script's structure.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$FRAMEWORK_DIR/sandcat/scripts/wg-client-init.sh"

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

echo "# sandcat-wg-readiness"

# ── 1. script still parses ───────────────────────────────────────────────
if bash -n "$SCRIPT" 2>/dev/null; then
  ok "wg-client-init.sh parses"
else
  fail "wg-client-init.sh has a syntax error"
fi

# ── 2. the peer initiates rather than waiting for traffic ────────────────
# Without persistent-keepalive the handshake only fires on the first outbound
# packet, so the wait below would have nothing to observe.
if grep -q 'persistent-keepalive' "$SCRIPT"; then
  ok "peer configured with persistent-keepalive"
else
  fail "no persistent-keepalive — handshake would not be initiated"
fi

# ── 3. readiness is gated on a handshake, and the gate precedes the signal ─
if grep -q 'latest-handshakes' "$SCRIPT"; then
  ok "readiness checks latest-handshakes"
else
  fail "readiness does not check for a handshake"
fi

WAIT_LINE=$(grep -n 'latest-handshakes' "$SCRIPT" | head -1 | cut -d: -f1)
TOUCH_LINE=$(grep -n '^touch /tmp/wg-ready' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -n "$WAIT_LINE" ] && [ -n "$TOUCH_LINE" ] && [ "$WAIT_LINE" -lt "$TOUCH_LINE" ]; then
  ok "handshake gate precedes touch /tmp/wg-ready"
else
  fail "handshake gate does not precede the readiness signal ($WAIT_LINE vs $TOUCH_LINE)"
fi

# A failed handshake must abort, not fall through to signalling ready.
if sed -n "${WAIT_LINE},${TOUCH_LINE}p" "$SCRIPT" | grep -q 'exit 1'; then
  ok "a missing handshake aborts before signalling readiness"
else
  fail "a missing handshake does not abort"
fi

# ── 4. the handshake predicate itself ────────────────────────────────────
# Extract the exact awk program the script uses so the test tracks the source.
AWK_PROG=$(grep -F 'latest-handshakes' "$SCRIPT" | grep -o "awk '.*'" | head -1 | sed "s/^awk '//; s/'$//")
if [ -z "$AWK_PROG" ]; then
  fail "could not extract the handshake awk predicate"
else
  ok "handshake predicate extracted from the script"

  # returns 0 when a handshake has happened, 1 otherwise
  probe() { printf '%s\n' "$1" | awk "$AWK_PROG"; }

  # `wg show <if> latest-handshakes` prints "<peer-pubkey>\t<unix-ts>", ts 0
  # until the first handshake completes.
  if ! probe "$(printf 'abc123=\t0')"; then
    ok "no handshake (timestamp 0) is not ready"
  else
    fail "timestamp 0 was treated as ready"
  fi

  if probe "$(printf 'abc123=\t1785200000')"; then
    ok "a completed handshake is ready"
  else
    fail "a real handshake timestamp was not treated as ready"
  fi

  if ! probe ""; then
    ok "empty output (interface absent) is not ready"
  else
    fail "empty output was treated as ready"
  fi

  # Multiple peers: any one handshake means the tunnel is up.
  if probe "$(printf 'aaa=\t0\nbbb=\t1785200000')"; then
    ok "one handshaked peer among several is ready"
  else
    fail "a handshaked peer was missed when another peer had none"
  fi

  # Guard against a string-compare regression: "0" is falsy numerically but
  # truthy as a non-empty string, which is why the script forces $2 + 0.
  if ! probe "$(printf 'aaa=\t0\nbbb=\t0')"; then
    ok "all-zero timestamps are not ready"
  else
    fail "all-zero timestamps were treated as ready"
  fi
fi

# ── 5. the wait is bounded ───────────────────────────────────────────────
if grep -q 'HANDSHAKE_TIMEOUT' "$SCRIPT"; then
  ok "handshake wait is bounded by HANDSHAKE_TIMEOUT"
else
  fail "handshake wait is unbounded"
fi

echo ""
echo "# passed $OK, failed $FAIL"
[ "$FAIL" -eq 0 ]
