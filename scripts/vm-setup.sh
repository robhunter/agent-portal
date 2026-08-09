#!/bin/bash
# scripts/vm-setup.sh — Set up a fresh container/VM to run an agent.
# Usage: vm-setup.sh [agent-dir]
#
# Prerequisites:
#   - Ubuntu/Debian (1GB+ RAM)
#   - Git installed
#   - Agent repo cloned
#
# What this script does:
#   1. Installs Node.js (via nvm)
#   2. Installs Claude Code CLI
#   3. Installs GitHub CLI (gh) and configures auth
#   4. Configures git identity
#
# What you do manually after:
#   - claude /login  (authenticate Claude Code)
#   - Test: bash scripts/wake.sh
set -e

FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="${1:-$(pwd)}"
cd "$AGENT_DIR"

# Source .env for GH_TOKEN and git identity
if [ -f "$AGENT_DIR/.env" ]; then
  set -a; . "$AGENT_DIR/.env"; set +a
fi

# Read agent config if agent.yaml exists
AGENT_NAME="agent"
if [ -f "$AGENT_DIR/agent.yaml" ]; then
  eval "$(node "$FRAMEWORK_DIR/scripts/read-config.js" "$AGENT_DIR/agent.yaml" 2>/dev/null)" || true
fi

echo "=== Agent VM Setup ($AGENT_NAME) ==="
echo "Agent directory: $AGENT_DIR"
echo "Framework directory: $FRAMEWORK_DIR"
echo ""

# Step 1: Node.js via nvm
#
# An agent that builds someone else's repo needs the version THAT repo's CI
# uses, not whatever `--lts` resolves to this month. fleethd-coder hit exactly
# this: its container came up on 24.19.0 while fleet-hd-wrench-core's pipeline
# pins 22.x, so every "green here" carried an unstated caveat. Drop a .nvmrc in
# the agent repo to pin it; agents that do not care keep getting --lts.
NODE_SPEC="--lts"
NODE_SOURCE="latest LTS"
if [ -f "$AGENT_DIR/.nvmrc" ]; then
  # [[:space:]] — the inner brackets are required. `tr -d '[:space:]'` deletes
  # the literal characters [ : s p a c e ], which silently mangles a spec like
  # lts/jod into lt/jod.
  NODE_SPEC="$(tr -d '[[:space:]]' < "$AGENT_DIR/.nvmrc")"
  NODE_SOURCE="$AGENT_DIR/.nvmrc"
fi

# nvm.sh is not safe to source under `set -e`. When a .nvmrc sits in the working
# directory — which it does here, because this script cd's into the agent dir —
# sourcing it performs an auto-use that returns 3 for a version not yet
# installed, and `set -e` turns that into a fatal abort before nvm is even
# usable. Every source below is bracketed accordingly.
nvm_load() {
  export NVM_DIR="$HOME/.nvm"
  set +e
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  set -e
  command -v nvm >/dev/null 2>&1 || { echo "ERROR: nvm did not load from $NVM_DIR" >&2; return 1; }
}

if ! command -v node &>/dev/null; then
  echo "--- Installing nvm and Node.js ($NODE_SPEC, from $NODE_SOURCE) ---"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm_load
  nvm install "$NODE_SPEC"
  nvm alias default "$(nvm current)"
  echo "  node $(node --version) (default: $(nvm current))"
  echo ""
else
  echo "--- Node.js already installed: $(node --version) ---"
  # Already installed but pinned elsewhere — realign rather than letting a
  # silent mismatch surface later as a CI-only failure.
  #
  # Best-effort on purpose: node can be present without nvm (a system package,
  # a base image). Failing to realign is worth a warning, not a dead setup —
  # the agent still has a working node.
  if [ -f "$AGENT_DIR/.nvmrc" ] && ! node --version | grep -q "^v${NODE_SPEC#v}\."; then
    if nvm_load; then
      echo "--- .nvmrc wants $NODE_SPEC, have $(node --version) — installing ---"
      nvm install "$NODE_SPEC"
      nvm alias default "$NODE_SPEC"
      echo "  now on $(node --version)"
    else
      echo "WARNING: .nvmrc wants $NODE_SPEC but nvm is unavailable; staying on $(node --version)" >&2
    fi
  fi
fi

# Step 2: Claude Code
if ! command -v claude &>/dev/null; then
  echo "--- Installing Claude Code ---"
  npm install -g @anthropic-ai/claude-code
  echo ""
else
  echo "--- Claude Code already installed: $(claude --version 2>/dev/null || echo 'unknown version') ---"
fi

# Step 2b: Codex CLI — only for agents whose harness is codex. Claude-only
# agents skip this; there is no reason to carry a second harness they never
# invoke. Run from the agent directory, so ./portal.config.json is the agent's.
if grep -q '"type"[[:space:]]*:[[:space:]]*"codex"' portal.config.json 2>/dev/null; then
  if ! command -v codex &>/dev/null; then
    echo "--- Installing Codex CLI ---"
    npm install -g @openai/codex
    echo ""
    echo "    NOTE: Codex still needs a one-time interactive login:"
    echo "      codex login --device-auth"
    echo "    Credentials land in ~/.codex/auth.json (bind-mounted from the host)."
    echo ""
  else
    echo "--- Codex already installed: $(codex --version 2>/dev/null || echo 'unknown version') ---"
  fi
fi

# Step 2c: adb — only for agents that declare a device mount.
#
# The container never runs an Android build; it has no NDK and could not. What
# it needs is the adb CLIENT, which talks to the adb SERVER on the host via
# ANDROID_ADB_SERVER_ADDRESS. That is enough to install, drive and screenshot an
# emulator running on the Mac. Gated on `mounts` being declared so no other
# agent carries an Android toolchain it never invokes.
if grep -q '"mounts"' portal.config.json 2>/dev/null; then
  if ! command -v adb &>/dev/null; then
    echo "--- Installing adb (client only; the server runs on the host) ---"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq android-sdk-platform-tools-common adb \
      >/dev/null 2>&1 || apt-get install -y -qq adb >/dev/null 2>&1 || \
      echo "WARNING: adb install failed — mobile work will be blocked"
    command -v adb >/dev/null && echo "  $(adb --version 2>/dev/null | head -1)"
    echo ""
  else
    echo "--- adb already installed: $(adb --version 2>/dev/null | head -1) ---"
  fi
fi

# Step 3: GitHub CLI
if ! command -v gh &>/dev/null; then
  echo "--- Installing GitHub CLI ---"
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  apt-get update -qq && apt-get install -y -qq gh
  echo ""
else
  echo "--- GitHub CLI already installed: $(gh --version | head -1) ---"
fi

# Configure gh auth if GH_TOKEN is available
if [ -n "$GH_TOKEN" ] && command -v gh &>/dev/null; then
  echo "--- Configuring gh auth ---"
  echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null || true
  gh auth setup-git 2>/dev/null || true
  echo "  gh auth status: $(gh auth status 2>&1 | grep -o 'Logged in.*' || echo 'not configured')"
  echo ""
fi

# Step 4: Git identity
if [ -n "$GIT_AUTHOR_NAME" ]; then
  echo "--- Configuring git identity from env ---"
  git config --global user.name "$GIT_AUTHOR_NAME"
  git config --global user.email "${GIT_AUTHOR_EMAIL:-${AGENT_NAME}@agent.local}"
else
  echo "--- Configuring git identity (defaults for $AGENT_NAME) ---"
  git config --global user.name "$AGENT_NAME"
  git config --global user.email "${AGENT_NAME}@agent.local"
fi
echo "  user.name: $(git config --global user.name)"
echo "  user.email: $(git config --global user.email)"
echo ""

# Step 5: Install framework dependencies
echo "--- Installing framework dependencies ---"
(cd "$FRAMEWORK_DIR" && npm install --production 2>&1) || echo "Warning: framework npm install failed"
echo ""

echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Authenticate Claude Code:"
echo "       claude /login"
echo ""
echo "  2. Test a manual cycle:"
echo "       bash $FRAMEWORK_DIR/scripts/wake.sh $AGENT_DIR"
echo ""
