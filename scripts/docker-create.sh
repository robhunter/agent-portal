#!/bin/bash
#
# scripts/docker-create.sh — Create (or recreate) a single-container agent.
#
# Usage: docker-create.sh <agent-dir>
#
# Run from the HOST machine (macOS or Linux), not inside a container.
#
# This will:
#   1. Remove any existing container for this agent
#   2. Create a new container with start.sh entrypoint
#   3. Install system packages (curl, jq, git, cron)
#   4. Clone the agent-portal framework inside the container
#   5. Run vm-setup.sh (nvm, node, claude, gh, git identity, cron jobs)
#   6. Install framework dependencies (requires node from step 5)
#   7. Restart so start.sh finds the framework and boots fully
#
# Prerequisites:
#   - Docker running
#   - .env file with GH_TOKEN and git identity vars
#   - Agent repo cloned at <agent-dir> with agent.yaml
#
# After creation, authenticate Claude inside the container:
#   docker exec -it <agent-name> bash -c 'source ~/.nvm/nvm.sh && claude'
#
set -e

# ── Arguments ─────────────────────────────────────────────────────────────
AGENT_DIR="${1:?Usage: docker-create.sh <agent-dir>}"
AGENT_DIR="$(cd "$AGENT_DIR" && pwd)"

# ── Read agent.yaml ───────────────────────────────────────────────────────
_yaml_value() {
    grep "^${1}:" "$AGENT_DIR/agent.yaml" \
        | sed 's/^[^:]*:[[:space:]]*//' \
        | sed "s/[[:space:]]*#.*//" \
        | sed "s/^[\"']//" \
        | sed "s/[\"']$//" \
        | sed 's/[[:space:]]*$//'
}

AGENT_NAME=$(_yaml_value name)
AGENT_PORT=$(_yaml_value port)
AGENT_REPO=$(_yaml_value repo)

if [ -z "$AGENT_NAME" ] || [ -z "$AGENT_PORT" ]; then
    echo "ERROR: Could not read 'name' or 'port' from $AGENT_DIR/agent.yaml" >&2
    exit 1
fi

if ! echo "$AGENT_PORT" | grep -qE '^[0-9]+$'; then
    echo "ERROR: 'port' in agent.yaml is not a valid number: $AGENT_PORT" >&2
    exit 1
fi

CONTAINER_AGENT_DIR="/root/$AGENT_NAME"
FRAMEWORK_DIR="/root/workspaces/agent-portal"

echo "=== Docker Create: $AGENT_NAME ==="
echo "  Agent directory: $AGENT_DIR"
echo "  Agent port:      $AGENT_PORT"

# ── Validate .env ─────────────────────────────────────────────────────────
if [ ! -f "$AGENT_DIR/.env" ]; then
    echo "ERROR: No .env file found in $AGENT_DIR" >&2
    exit 1
fi

# ── Remove existing container ─────────────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -q "^${AGENT_NAME}$"; then
    echo ""
    echo "Removing existing $AGENT_NAME container..."
    docker stop "$AGENT_NAME" 2>/dev/null || true
    docker rm -f "$AGENT_NAME"
fi

# ── Create container ──────────────────────────────────────────────────────
echo ""
echo "Creating $AGENT_NAME container..."
docker run -d --name "$AGENT_NAME" --restart unless-stopped \
    -v "$AGENT_DIR:$CONTAINER_AGENT_DIR" \
    -v "${HOME}/.claude:/root/.claude" \
    --env-file "$AGENT_DIR/.env" \
    -p "$AGENT_PORT:$AGENT_PORT" \
    ubuntu:24.04 \
    bash "$CONTAINER_AGENT_DIR/scripts/start.sh"

# ── Install system packages ──────────────────────────────────────────────
echo "Installing system packages..."
docker exec "$AGENT_NAME" bash -c \
    "apt-get update -qq && apt-get install -y -qq curl jq git cron ca-certificates > /dev/null 2>&1"

# ── Clone agent-portal framework ─────────────────────────────────────────
echo "Cloning agent-portal framework..."
docker exec "$AGENT_NAME" bash -c \
    "source $CONTAINER_AGENT_DIR/.env && \
     mkdir -p /root/workspaces && \
     git clone https://\${GH_TOKEN}@github.com/robhunter/agent-portal.git $FRAMEWORK_DIR"

# ── Run vm-setup.sh ──────────────────────────────────────────────────────
echo "Running vm-setup.sh..."
docker exec "$AGENT_NAME" bash -c \
    "cd $CONTAINER_AGENT_DIR && bash $FRAMEWORK_DIR/scripts/vm-setup.sh"

# ── Install framework dependencies ───────────────────────────────────────
echo "Installing framework dependencies..."
docker exec "$AGENT_NAME" bash -c \
    "source ~/.nvm/nvm.sh && cd $FRAMEWORK_DIR && npm install --production"

# ── Restart for clean boot ────────────────────────────────────────────────
echo ""
echo "Restarting container so all services start cleanly..."
docker restart "$AGENT_NAME"

sleep 3

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo "=== $AGENT_NAME container is ready ==="
echo ""
echo "  NEXT STEP: Authenticate Claude:"
echo "    docker exec -it $AGENT_NAME bash -c 'source ~/.nvm/nvm.sh && claude'"
echo ""
echo "  Web portal:  http://localhost:$AGENT_PORT"
echo "  Status API:  curl http://localhost:$AGENT_PORT/api/status"
echo "  Interactive:  docker exec -it $AGENT_NAME bash"
echo "  Logs:         docker logs $AGENT_NAME"
