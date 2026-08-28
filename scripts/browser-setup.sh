#!/bin/bash
# scripts/browser-setup.sh — Make shot-scraper able to actually take a screenshot.
#
# Usage:
#   bash scripts/browser-setup.sh            # verify, and install whatever is missing
#   bash scripts/browser-setup.sh --check    # verify only, install nothing (exit 1 if broken)
#
# Agent CLAUDE.md files tell agents to verify UI work with
#   scripts/memory-venv/bin/shot-scraper <url> -o out.png
# but nothing in this repo ever installed it. It was pip-installed by hand in
# March, so it survived only as long as that one container did — a rebuild left
# every agent pointing at a path that does not exist.
#
# There are three independent layers, and each can be missing on its own:
#
#   1. the shot-scraper and playwright Python packages, in the memory venv
#   2. the Chromium build under ~/.cache/ms-playwright
#   3. the system shared libraries Chromium links against (libnss3, libgbm1, ...)
#
# Layer 3 is why this script probes instead of checking for files. A container
# can have the venv, the CLI and a 600MB Chromium and still fail every single
# screenshot, because `apt` never installed the libraries the binary links
# against. Any presence check — `command -v shot-scraper`, `[ -d ms-playwright ]`
# — reports that container as healthy. The only check that distinguishes the two
# states is taking a screenshot, so that is the check.
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$FRAMEWORK_DIR/scripts/memory-venv"
SHOT="$VENV_DIR/bin/shot-scraper"
PLAYWRIGHT="$VENV_DIR/bin/playwright"

CHECK_ONLY=false
[ "$1" = "--check" ] && CHECK_ONLY=true

# Probe: render a local file and confirm a real PNG came out the other side.
#
# Deliberately offline. If the probe fetched a URL, a network blip would read as
# "the browser is broken" and trigger a needless 600MB re-download; worse, a
# captive portal or proxy error page would render fine and report success.
#
# Checks the PNG magic bytes rather than just the exit code, because "wrote
# something to the output path" and "produced an image" are different claims and
# only the second one is the capability we are promising.
probe() {
  local dir file out
  dir=$(mktemp -d)
  file="$dir/probe.html"
  out="$dir/probe.png"
  printf '<html><body><h1>probe</h1></body></html>' > "$file"

  set +e
  PROBE_ERR=$("$SHOT" "$file" -o "$out" --width 200 --height 100 2>&1)
  local rc=$?
  set -e

  if [ $rc -ne 0 ] || [ ! -s "$out" ]; then
    rm -rf "$dir"
    return 1
  fi

  # PNG signature: \x89 P N G
  if [ "$(head -c 4 "$out" | od -An -tx1 | tr -d ' \n')" != "89504e47" ]; then
    PROBE_ERR="output file is not a PNG"
    rm -rf "$dir"
    return 1
  fi

  rm -rf "$dir"
  return 0
}

if [ -x "$SHOT" ] && probe; then
  echo "shot-scraper is working ($("$SHOT" --version 2>/dev/null || echo 'version unknown'))"
  exit 0
fi

if [ "$CHECK_ONLY" = true ]; then
  echo "shot-scraper cannot take a screenshot." >&2
  [ -n "$PROBE_ERR" ] && echo "$PROBE_ERR" | tail -5 >&2
  echo "Run: bash $FRAMEWORK_DIR/scripts/browser-setup.sh" >&2
  exit 1
fi

echo "=== Browser setup (shot-scraper) ==="

# Layer 1: the venv and the Python packages.
if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "--- Creating memory venv ---"
  bash "$FRAMEWORK_DIR/scripts/memory-setup.sh"
fi

if [ ! -x "$SHOT" ]; then
  echo "--- Installing shot-scraper ---"
  "$VENV_DIR/bin/pip" install --quiet shot-scraper
fi

# Layer 3 before layer 2: `shot-scraper install` downloads the browser and then
# validates host requirements, so with the libraries missing it spends the whole
# download and exits non-zero at the end. Installing the libraries first turns
# that into one clean pass.
#
# `playwright install-deps` is preferred over a hardcoded apt list because the
# package names are distro-specific — Ubuntu 24.04 renamed a third of them with
# a t64 suffix for the 64-bit time_t ABI switch, so a list pinned to one release
# silently installs nothing useful on another.
if [ "$(id -u)" = "0" ]; then
  APT_PREFIX=""
elif command -v sudo >/dev/null 2>&1; then
  APT_PREFIX="sudo"
else
  echo "WARNING: not root and no sudo — cannot install system libraries." >&2
  echo "         If the probe below fails, install Chromium's dependencies as root." >&2
  APT_PREFIX="skip"
fi

if [ "$APT_PREFIX" != "skip" ]; then
  echo "--- Installing Chromium system libraries ---"
  $APT_PREFIX env DEBIAN_FRONTEND=noninteractive apt-get update -qq || \
    echo "WARNING: apt-get update failed (continuing)" >&2
  if ! $APT_PREFIX env DEBIAN_FRONTEND=noninteractive "$PLAYWRIGHT" install-deps chromium >/dev/null 2>&1; then
    echo "    playwright install-deps failed — falling back to an explicit package list" >&2
    $APT_PREFIX env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
      libxkbcommon0 libatspi2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 \
      libxrandr2 libgbm1 libcairo2 libpango-1.0-0 libasound2t64 >/dev/null 2>&1 || \
      echo "WARNING: fallback package install failed" >&2
  fi
fi

# Layer 2: the browser itself (~600MB, so only after the probe has failed).
echo "--- Installing Chromium for Playwright ---"
if ! "$SHOT" install 2>&1 | tail -20; then
  echo "WARNING: shot-scraper install reported a failure" >&2
fi

# Re-probe. An installer that cannot demonstrate the capability it just
# installed has not finished.
if probe; then
  echo ""
  echo "=== shot-scraper is working ==="
  exit 0
fi

echo "" >&2
echo "ERROR: shot-scraper still cannot take a screenshot after setup." >&2
echo "$PROBE_ERR" | tail -20 >&2
exit 1
