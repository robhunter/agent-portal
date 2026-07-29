#!/bin/bash
# sandcat-setup-timeout.test.sh — Verify docker-compose-create.sh bounds its
# in-container setup steps and fails loudly instead of hanging.
#
# Context: the agent container is bare ubuntu:24.04; node, claude and the npm
# deps are installed post-boot into its writable layer by that script. When
# `nvm install --lts` stalls on egress the step never returns, the script never
# reaches its final restart, and the caller (flenderson spawns it with no
# timeout of its own) shows a rebuild that runs forever.
#
# We cannot run Docker here, so we exercise run_setup_step's exit-code handling
# by sourcing the helper with $COMPOSE stubbed. That is the whole of the logic
# this change adds.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$FRAMEWORK_DIR/scripts/docker-compose-create.sh"

OK=0
FAIL=0
ok()   { echo "  ok - $*"; OK=$((OK+1)); }
fail() { echo "  not ok - $*"; FAIL=$((FAIL+1)); }

echo "# sandcat-setup-timeout"

# ── 1. the script is syntactically valid ─────────────────────────────────
if bash -n "$SCRIPT" 2>/dev/null; then
  ok "docker-compose-create.sh parses"
else
  fail "docker-compose-create.sh has a syntax error"
fi

# ── 2. every in-container setup step is bounded ──────────────────────────
# A bare `$COMPOSE exec -T agent bash -c` in the setup block is exactly the
# unbounded form this change exists to remove.
SETUP_BLOCK=$(sed -n '/── Run setup inside agent container/,/── Restart agent service/p' "$SCRIPT")
if echo "$SETUP_BLOCK" | grep -q 'exec -T agent bash -c'; then
  fail "an unbounded 'exec -T agent bash -c' remains in the setup block"
else
  ok "no unbounded exec remains in the setup block"
fi

if echo "$SETUP_BLOCK" | grep -q 'timeout "\$SETUP_TIMEOUT"'; then
  ok "setup steps run under SETUP_TIMEOUT"
else
  fail "setup steps are not run under a timeout"
fi

# timeout must run inside the container: macOS hosts have no coreutils timeout.
if echo "$SETUP_BLOCK" | grep -q 'exec -T agent timeout'; then
  ok "timeout is invoked inside the container, not on the host"
else
  fail "timeout is not invoked inside the container (breaks on macOS hosts)"
fi

# ── 3. run_setup_step exit-code handling ─────────────────────────────────
# Extract the helper and drive it with a stubbed $COMPOSE.
HELPER=$(sed -n '/^run_setup_step() {/,/^}/p' "$SCRIPT")
if [ -z "$HELPER" ]; then
  fail "run_setup_step not found"
else
  ok "run_setup_step is defined"

  run_case() { # <stub-exit-code> -> prints "rc=<exit> out=<stderr first line>"
    local stub_rc="$1" tmp
    tmp=$(mktemp -t sandcat-setup-XXXXXX)
    {
      echo 'SETUP_TIMEOUT=600'
      echo "COMPOSE=\"exit $stub_rc; \""
      # Stub: swallow the real invocation and return the code under test.
      echo "$HELPER" | sed 's|\$COMPOSE exec -T agent timeout "\$SETUP_TIMEOUT" bash -c "\$1"|( exit '"$stub_rc"' )|'
      echo 'run_setup_step "stub step" "true"'
      echo 'echo REACHED_END'
    } > "$tmp"
    bash "$tmp" 2>&1
    echo "rc=$?"
    rm -f "$tmp"
  }

  OUT=$(run_case 0)
  if echo "$OUT" | grep -q REACHED_END; then
    ok "a successful step continues"
  else
    fail "a successful step did not continue: $OUT"
  fi

  OUT=$(run_case 124)
  if echo "$OUT" | grep -q "exceeded 600s"; then
    ok "a timed-out step (124) reports the timeout"
  else
    fail "a timed-out step did not report the timeout: $OUT"
  fi
  if echo "$OUT" | grep -q REACHED_END; then
    fail "a timed-out step continued instead of aborting"
  else
    ok "a timed-out step aborts"
  fi

  OUT=$(run_case 7)
  if echo "$OUT" | grep -q "failed (exit 7)"; then
    ok "a failing step reports its exit code"
  else
    fail "a failing step did not report its exit code: $OUT"
  fi
  if echo "$OUT" | grep -q REACHED_END; then
    fail "a failing step continued instead of aborting"
  else
    ok "a failing step aborts"
  fi
fi

# ── 4. the runtime is asserted before the script claims success ──────────
if grep -q 'Verifying node, npm and claude are installed' "$SCRIPT"; then
  ok "runtime verification step present"
else
  fail "no runtime verification before the final restart"
fi

# The assertion must precede the final restart, or it verifies nothing useful.
VERIFY_LINE=$(grep -n 'Verifying node, npm and claude' "$SCRIPT" | head -1 | cut -d: -f1)
RESTART_LINE=$(grep -n '^\$COMPOSE restart agent' "$SCRIPT" | head -1 | cut -d: -f1)
if [ -n "$VERIFY_LINE" ] && [ -n "$RESTART_LINE" ] && [ "$VERIFY_LINE" -lt "$RESTART_LINE" ]; then
  ok "verification runs before the final restart"
else
  fail "verification does not precede the final restart ($VERIFY_LINE vs $RESTART_LINE)"
fi

echo ""
echo "# passed $OK, failed $FAIL"
[ "$FAIL" -eq 0 ]
