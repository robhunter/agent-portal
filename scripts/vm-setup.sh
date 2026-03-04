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
if ! command -v node &>/dev/null; then
  echo "--- Installing nvm and Node.js ---"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install --lts
  echo ""
else
  echo "--- Node.js already installed: $(node --version) ---"
fi

# Step 2: Claude Code
if ! command -v claude &>/dev/null; then
  echo "--- Installing Claude Code ---"
  npm install -g @anthropic-ai/claude-code
  echo ""
else
  echo "--- Claude Code already installed: $(claude --version 2>/dev/null || echo 'unknown version') ---"
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
