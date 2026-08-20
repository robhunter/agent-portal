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
# uses, not whatever `--lts` resolves to this month — a container on a newer
# major than the target pipeline makes every "green here" carry an unstated
# caveat. Drop a .nvmrc in the agent repo to pin it; agents that do not care
# keep getting --lts.
NODE_SPEC="--lts"
NODE_SOURCE="latest LTS"
if [ -f "$AGENT_DIR/.nvmrc" ]; then
  NODE_SPEC="$(tr -d '[:space:]' < "$AGENT_DIR/.nvmrc")"
  NODE_SOURCE="$AGENT_DIR/.nvmrc"
fi

if ! command -v node &>/dev/null; then
  echo "--- Installing nvm and Node.js ($NODE_SPEC, from $NODE_SOURCE) ---"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install $NODE_SPEC
  nvm alias default "$(nvm current)"
  echo ""
else
  echo "--- Node.js already installed: $(node --version) ---"
  # Already installed but pinned elsewhere — say so rather than letting a
  # silent mismatch surface later as a CI-only failure.
  if [ -f "$AGENT_DIR/.nvmrc" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    if ! node --version | grep -q "^v${NODE_SPEC#v}"; then
      echo "--- .nvmrc wants $NODE_SPEC, have $(node --version) — installing ---"
      nvm install "$NODE_SPEC" && nvm alias default "$NODE_SPEC"
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
