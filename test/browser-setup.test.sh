#!/bin/bash
# Test scripts/browser-setup.sh --check against stub shot-scraper binaries.
#
# The point of the script is that a *presence* check (the CLI exists, the
# browser directory exists) reports a container as healthy when it cannot take a
# screenshot. So the thing worth testing is the discrimination: which outcomes
# does --check call working, and which does it call broken. Each case below
# stubs shot-scraper to produce one specific outcome, so the suite is hermetic —
# no browser, no network, no apt.
set -e

PASS=0
FAIL=0
TESTS=0

assert_eq() {
  TESTS=$((TESTS + 1))
  if [ "$1" = "$2" ]; then
    PASS=$((PASS + 1))
    echo "  ok - $3"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL - $3 (expected '$1', got '$2')"
  fi
}

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "# browser-setup.sh tests"

# Build a fake framework tree. browser-setup.sh derives every path from its own
# location, so a copy in $WORK/scripts finds $WORK/scripts/memory-venv/bin.
mkdir -p "$WORK/scripts/memory-venv/bin"
cp "$REPO_DIR/scripts/browser-setup.sh" "$WORK/scripts/browser-setup.sh"
SCRIPT="$WORK/scripts/browser-setup.sh"
STUB="$WORK/scripts/memory-venv/bin/shot-scraper"

# Each stub is invoked as: shot-scraper <html> -o <out.png> --width .. --height ..
# so the output path is $3.
write_stub() {
  printf '#!/bin/bash\n%s\n' "$1" > "$STUB"
  chmod +x "$STUB"
}

run_check() {
  set +e
  CHECK_OUT=$(bash "$SCRIPT" --check 2>&1)
  CHECK_RC=$?
  set -e
}

# --- Test 1: a real PNG comes out — working ---
echo "## Test 1: stub writes a valid PNG"
write_stub 'printf "\x89PNG\r\n\x1a\n____________" > "$3"; exit 0'
run_check
assert_eq "0" "$CHECK_RC" "exit 0 when the stub produces a PNG"

# --- Test 2: exit 0, but the bytes are not an image ---
# This is the case a naive check misses. Something wrote to the output path, so
# the file exists and is non-empty, but no screenshot was taken.
echo "## Test 2: stub writes a non-PNG file and exits 0"
write_stub 'echo "<html>error page</html>" > "$3"; exit 0'
run_check
assert_eq "1" "$CHECK_RC" "exit 1 when the output is not a PNG"

# --- Test 3: the browser fails to launch — nothing written ---
echo "## Test 3: stub fails without writing output"
write_stub 'echo "Executable does not exist" >&2; exit 1'
run_check
assert_eq "1" "$CHECK_RC" "exit 1 when the stub fails"

# --- Test 3b: success reported, but no file produced ---
# The missing-file guard is what makes this case readable. The exit code alone
# does not reach it (the tool claimed success) so the PNG check downstream would
# read a file that was never created, and prepend `head: cannot open ...` to the
# diagnostic an operator is about to act on.
echo "## Test 3b: stub exits 0 without writing output"
write_stub 'exit 0'
run_check
assert_eq "1" "$CHECK_RC" "exit 1 when the stub claims success but writes nothing"
TESTS=$((TESTS + 1))
if echo "$CHECK_OUT" | grep -qi "cannot open"; then
  FAIL=$((FAIL + 1))
  echo "  FAIL - failure output leaks a read error for the missing file: $CHECK_OUT"
else
  PASS=$((PASS + 1))
  echo "  ok - failure output is about the browser, not the missing output file"
fi

# --- Test 4: exit 0 with an empty file ---
echo "## Test 4: stub exits 0 but writes an empty file"
write_stub 'touch "$3"; exit 0'
run_check
assert_eq "1" "$CHECK_RC" "exit 1 when the output file is empty"

# --- Test 5: a valid PNG, but shot-scraper reported failure ---
# Only the exit-code guard catches this: the file exists, is non-empty, and
# carries a PNG signature. A tool that says it failed is not evidence of a
# working browser, whatever it left behind.
echo "## Test 5: stub writes a valid PNG but exits non-zero"
write_stub 'printf "\x89PNG\r\n\x1a\n____________" > "$3"; echo "Timeout 30000ms exceeded" >&2; exit 1'
run_check
assert_eq "1" "$CHECK_RC" "exit 1 when shot-scraper reports failure despite output"

# --- Test 6: --check installs nothing ---
# A --check that could apt-get or download 600MB is not a check. The stub here
# fails, which is the branch that would otherwise fall through to installing.
echo "## Test 6: --check does not install"
write_stub 'exit 1'
BEFORE=$(find "$WORK" -type f | sort | md5sum)
run_check
AFTER=$(find "$WORK" -type f | sort | md5sum)
assert_eq "$BEFORE" "$AFTER" "--check leaves the tree unmodified on failure"
assert_eq "1" "$CHECK_RC" "--check still reports failure"

# --- Test 7: failure output names the remedy ---
echo "## Test 7: failure output points at the fix"
TESTS=$((TESTS + 1))
if echo "$CHECK_OUT" | grep -q "browser-setup.sh"; then
  PASS=$((PASS + 1))
  echo "  ok - failure message names browser-setup.sh"
else
  FAIL=$((FAIL + 1))
  echo "  FAIL - failure message does not name the remedy: $CHECK_OUT"
fi

# --- Test 8: the real installation, when there is one ---
# Skipped rather than failed where no browser is provisioned, so the suite still
# runs in a bare CI container.
echo "## Test 8: the repo's own shot-scraper"
REAL="$REPO_DIR/scripts/memory-venv/bin/shot-scraper"
if [ -x "$REAL" ]; then
  set +e
  bash "$REPO_DIR/scripts/browser-setup.sh" --check >/dev/null 2>&1
  REAL_RC=$?
  REAL_DIR=$(mktemp -d)
  printf '<html><body><h1>x</h1></body></html>' > "$REAL_DIR/p.html"
  "$REAL" "$REAL_DIR/p.html" -o "$REAL_DIR/p.png" --width 200 --height 100 >/dev/null 2>&1
  SHOT_RC=$?
  set -e
  [ -s "$REAL_DIR/p.png" ] || SHOT_RC=1
  rm -rf "$REAL_DIR"
  assert_eq "$SHOT_RC" "$REAL_RC" "--check agrees with a direct screenshot attempt"
else
  echo "  skip - no shot-scraper installed in this checkout"
fi

echo ""
echo "# Results: $PASS/$TESTS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
