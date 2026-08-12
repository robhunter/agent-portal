#!/bin/bash
#
# scripts/docker-compose-create.sh — Generate and launch a Sandcat-isolated
# Docker Compose stack for an agent.
#
# Usage: docker-compose-create.sh <agent-dir> [framework-dir]
#
# Run from the HOST machine (macOS or Linux), not inside a container.
#
# This creates a three-container stack:
#   - mitmproxy: holds real secrets, substitutes placeholders for allowed hosts
#   - wg-client: WireGuard tunnel + iptables kill switch
#   - agent: runs the agent with placeholder env vars (no real secrets)
#
# Prerequisites:
#   - Docker and Docker Compose (v2.20+) installed
#   - ~/sandcat-secrets/<agent-name>/settings.json exists with real credentials
#   - Agent repo cloned at <agent-dir> with agent.yaml
#
# After creation, authenticate Claude inside the container:
#   docker compose -f ~/sandcat-stacks/<name>/docker-compose.yml \
#     exec agent bash -c 'source ~/.nvm/nvm.sh && claude'
#
set -e

# ── Arguments ─────────────────────────────────────────────────────────────
AGENT_DIR="${1:?Usage: docker-compose-create.sh <agent-dir> [framework-dir]}"
AGENT_DIR="$(cd "$AGENT_DIR" && pwd)"

FRAMEWORK_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
FRAMEWORK_DIR="$(cd "$FRAMEWORK_DIR" && pwd)"

# ── Read agent.yaml ───────────────────────────────────────────────────────
# This script runs on the HOST machine where Node.js may not be installed
# (npm install happens inside the container later). Shell parsing is
# intentional to keep host prerequisites minimal: just Docker + Compose.
# The sed trims quotes, trailing comments, and whitespace for robustness.
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
AGENT_TIMEZONE=$(_yaml_value timezone)

if [ -z "$AGENT_NAME" ] || [ -z "$AGENT_PORT" ]; then
    echo "ERROR: Could not read 'name' or 'port' from $AGENT_DIR/agent.yaml" >&2
    exit 1
fi

# Validate port is numeric
if ! echo "$AGENT_PORT" | grep -qE '^[0-9]+$'; then
    echo "ERROR: 'port' in agent.yaml is not a valid number: $AGENT_PORT" >&2
    exit 1
fi

CONTAINER_AGENT_DIR="/root/$AGENT_NAME"
CONTAINER_FRAMEWORK_DIR="/root/workspaces/agent-portal"

# ── Resolve timezone ─────────────────────────────────────────────────────
# Use agent.yaml timezone if set, otherwise detect from host.
if [ -z "$AGENT_TIMEZONE" ]; then
    # Try readlink (works on macOS and most Linux)
    AGENT_TIMEZONE=$(readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||')
    # Fallback: /etc/timezone (Debian/Ubuntu hosts)
    if [ -z "$AGENT_TIMEZONE" ]; then
        AGENT_TIMEZONE=$(cat /etc/timezone 2>/dev/null || echo "")
    fi
    # Last resort
    if [ -z "$AGENT_TIMEZONE" ]; then
        AGENT_TIMEZONE="UTC"
        echo "Warning: Could not detect host timezone, defaulting to UTC" >&2
    fi
fi

echo "=== Sandcat Stack: $AGENT_NAME ==="
echo "  Agent directory:     $AGENT_DIR"
echo "  Framework directory: $FRAMEWORK_DIR"
echo "  Agent port:          $AGENT_PORT"
echo "  Timezone:            $AGENT_TIMEZONE"

# ── Validate settings.json ────────────────────────────────────────────────
SETTINGS_DIR="$HOME/sandcat-secrets/$AGENT_NAME"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

if [ ! -f "$SETTINGS_FILE" ]; then
    echo "" >&2
    echo "ERROR: Settings file not found: $SETTINGS_FILE" >&2
    echo "" >&2
    echo "Create it with:" >&2
    echo "  mkdir -p $SETTINGS_DIR && chmod 700 $SETTINGS_DIR" >&2
    echo "  # Write settings.json with secrets and network rules" >&2
    echo "  chmod 600 $SETTINGS_FILE" >&2
    exit 1
fi

echo "  Settings file:       $SETTINGS_FILE"

# ── Prepare output directory ──────────────────────────────────────────────
STACK_DIR="$HOME/sandcat-stacks/$AGENT_NAME"
mkdir -p "$STACK_DIR"

# Harness credential stores are bind-mounted from the host so a login survives
# container recreation. Create them up front — a bind mount of a missing path
# makes Docker invent a root-owned directory, which then fails the login write.
mkdir -p "$HOME/.claude" "$HOME/.codex"

# ── Optional extra bind mounts ────────────────────────────────────────────
# portal.config.json may declare `mounts: { "<host path>": "<container path>" }`.
# fleethd-coder uses this for the fleethd-app checkout: that repo cannot be
# built in the container (no aarch64-Linux Android NDK), so Gradle and Metro run
# on the host against the SAME directory the agent edits. The shared checkout is
# the whole mechanism — a private clone would have the host building code the
# agent never wrote.
EXTRA_MOUNTS=""
if [ -f "$AGENT_DIR/portal.config.json" ] && command -v node >/dev/null 2>&1; then
    EXTRA_MOUNTS=$(node -e '
      const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8"));
      for (const [h, g] of Object.entries(c.mounts || {})) {
        console.log("      - " + h.replace(/^~/, process.env.HOME) + ":" + g);
      }' "$AGENT_DIR/portal.config.json")
    [ -n "$EXTRA_MOUNTS" ] && echo "  Extra mounts:" && echo "$EXTRA_MOUNTS"
fi

# ── Generate compose .env ─────────────────────────────────────────────────
# Docker Compose reads .env automatically for variable substitution in yml.
# Preserve existing web password if already generated.
if [ -f "$STACK_DIR/.env" ] && grep -q '^MITMPROXY_WEB_PASSWORD=' "$STACK_DIR/.env"; then
    MITMPROXY_WEB_PASSWORD=$(grep '^MITMPROXY_WEB_PASSWORD=' "$STACK_DIR/.env" | cut -d= -f2)
else
    MITMPROXY_WEB_PASSWORD=$(openssl rand -hex 16)
fi

cat > "$STACK_DIR/.env" << EOF
SANDCAT_SETTINGS_PATH=$SETTINGS_FILE
MITMPROXY_WEB_PASSWORD=$MITMPROXY_WEB_PASSWORD
EOF

echo "  Compose env:         $STACK_DIR/.env"

# ── Generate docker-compose.yml ───────────────────────────────────────────
# All three services are inlined into a single generated file. This avoids
# Docker Compose "include:" merge conflicts (you can't redefine a service
# from an included file to add ports).
#
# The framework is bind-mounted from the host so app-init.sh (the
# entrypoint) is available immediately — no need to clone the framework
# inside the container.
cat > "$STACK_DIR/docker-compose.yml" << COMPOSEOF
# Auto-generated by docker-compose-create.sh for agent: $AGENT_NAME
# Do not edit manually. Re-run docker-compose-create.sh to regenerate.

services:
  mitmproxy:
    image: mitmproxy/mitmproxy:latest
    command: >-
      mitmweb --mode wireguard --web-host 0.0.0.0
      --set web_password=$MITMPROXY_WEB_PASSWORD
      --ignore-hosts '(^|\.)mongodb\.net(:[0-9]+)?\$\$'
      -s /scripts/mitmproxy_addon.py
    ports:
      - "8081"
    volumes:
      - mitmproxy-config:/home/mitmproxy/.mitmproxy
      - $FRAMEWORK_DIR/sandcat/scripts/mitmproxy_addon.py:/scripts/mitmproxy_addon.py:ro
      - $SETTINGS_FILE:/config/settings.json:ro
    healthcheck:
      test: ["CMD", "test", "-f", "/home/mitmproxy/.mitmproxy/wireguard.conf", "-a", "-f", "/home/mitmproxy/.mitmproxy/sandcat.env"]
      interval: 2s
      timeout: 2s
      retries: 15

  wg-client:
    build:
      context: $FRAMEWORK_DIR/sandcat
      dockerfile: Dockerfile.wg-client
    volumes:
      - mitmproxy-config:/mitmproxy-config:ro
      - sandcat-certs:/sandcat-certs
    cap_add:
      - NET_ADMIN
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    extra_hosts:
      - "host.docker.internal:host-gateway"
    command: sleep infinity
    depends_on:
      mitmproxy:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "test", "-f", "/tmp/wg-ready"]
      interval: 2s
      timeout: 2s
      retries: 15
    ports:
      - "$AGENT_PORT:$AGENT_PORT"

  agent:
    image: ubuntu:24.04
    network_mode: "service:wg-client"
    volumes:
      - $AGENT_DIR:$CONTAINER_AGENT_DIR
      - $FRAMEWORK_DIR:$CONTAINER_FRAMEWORK_DIR
      - ${HOME}/.claude:/root/.claude
      - ${HOME}/.codex:/root/.codex
$EXTRA_MOUNTS
      - sandcat-certs:/sandcat-certs:ro
    entrypoint: ["bash", "$CONTAINER_FRAMEWORK_DIR/sandcat/scripts/app-init.sh", "$CONTAINER_AGENT_DIR"]
    environment:
      - TZ=$AGENT_TIMEZONE
      - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
      - NODE_EXTRA_CA_CERTS=/sandcat-certs/mitmproxy-ca-cert.pem
      # Codex is a Rust binary and ignores NODE_EXTRA_CA_CERTS and the system
      # trust store. Without this it cannot complete a TLS handshake through
      # mitmproxy — every request, including the device-auth login, fails.
      - CODEX_CA_CERTIFICATE=/sandcat-certs/mitmproxy-ca-cert.pem
      # adb speaks to the HOST's adb server; the client here is only a
      # client. Set unconditionally — harmless where adb is not installed.
      - ANDROID_ADB_SERVER_ADDRESS=host.docker.internal
      - ANDROID_ADB_SERVER_PORT=5037
    restart: unless-stopped
    depends_on:
      wg-client:
        condition: service_healthy

volumes:
  mitmproxy-config:
  sandcat-certs:
COMPOSEOF

echo "  Compose file:        $STACK_DIR/docker-compose.yml"

# ── Tailscale serve management ───────────────────────────────────────────
# If tailscale is installed, manage HTTPS serve for the agent's portal port.
# Disable before teardown (port conflict), re-enable after stack is healthy.
# Fails silently if tailscale is not installed or not configured.
HAS_TAILSCALE=false
if command -v tailscale >/dev/null 2>&1; then
    HAS_TAILSCALE=true
    echo ""
    echo "Disabling Tailscale serve on port $AGENT_PORT..."
    sudo tailscale serve --https="$AGENT_PORT" off 2>/dev/null || true
fi

# ── Stop existing containers ──────────────────────────────────────────────
# Stop any existing single-container setup (pre-Sandcat)
if docker ps -a --format '{{.Names}}' | grep -q "^${AGENT_NAME}$"; then
    echo ""
    echo "Stopping existing $AGENT_NAME container..."
    docker stop "$AGENT_NAME" 2>/dev/null || true
    docker rm -f "$AGENT_NAME" 2>/dev/null || true
fi

# Stop any existing compose stack
docker compose -f "$STACK_DIR/docker-compose.yml" down 2>/dev/null || true

# ── Build and start the stack ─────────────────────────────────────────────
echo ""
echo "Starting Docker Compose stack..."
docker compose -f "$STACK_DIR/docker-compose.yml" up -d --build

# ── Wait for healthchecks ─────────────────────────────────────────────────
echo "Waiting for services to be healthy..."
TIMEOUT=120
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
    # Check if wg-client is healthy (tunnel + iptables ready)
    WG_STATUS=$(docker compose -f "$STACK_DIR/docker-compose.yml" \
        ps --format json wg-client 2>/dev/null || echo "")
    if echo "$WG_STATUS" | grep -q '"healthy"'; then
        echo "  wg-client is healthy (tunnel ready)"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "ERROR: Timed out waiting for wg-client to become healthy" >&2
    echo "  Check logs: docker compose -f $STACK_DIR/docker-compose.yml logs" >&2
    exit 1
fi

# ── Run setup inside agent container ──────────────────────────────────────
COMPOSE="docker compose -f $STACK_DIR/docker-compose.yml"

# Every step below installs into the agent container's WRITABLE LAYER — the
# image is bare ubuntu:24.04. A recreate therefore returns the container to a
# state with no node, no claude and no npm deps, and this script is the only
# thing that puts them back. That makes it critical that a step which cannot
# finish is reported as a failure rather than waited on forever.
#
# It hangs rather than fails when egress stalls. `nvm install --lts`
# (vm-setup.sh) fetches from nodejs.org through the WireGuard/mitmproxy chain;
# if packets are dropped rather than refused, curl waits indefinitely, this
# script never reaches the final restart below, and the caller sees a rebuild
# that runs forever. Flenderson spawns this script with no timeout of its own,
# so its job stays "running" and its UI never reports an outcome.
#
# `timeout` runs INSIDE the container (Ubuntu coreutils) so this works from a
# macOS host, where `timeout` is not present by default. Exit 124 = timed out.
SETUP_TIMEOUT="${SETUP_TIMEOUT:-600}"

# Run a setup step in the agent container under a timeout, and fail loudly.
run_setup_step() {
    local label="$1"; shift
    local rc=0
    $COMPOSE exec -T agent timeout "$SETUP_TIMEOUT" bash -c "$1" || rc=$?
    if [ "$rc" -eq 124 ]; then
        echo "ERROR: '$label' exceeded ${SETUP_TIMEOUT}s and was killed." >&2
        echo "" >&2
        # This message used to assert egress as the cause and print an egress
        # probe. The one time it mattered, egress was perfect (30MB at 13MB/s)
        # and the real cause was a `PWD=` line in the agent's .env sending nvm's
        # .nvmrc search into an infinite loop. Naming a likely cause reads as a
        # diagnosis, and two people chased the network for an afternoon on the
        # strength of it. A bound that cannot say WHICH command stalled should
        # not guess — it should say how to find out.
        echo "  The step stalled rather than failed, so the cause is whatever it was" >&2
        echo "  running when the clock ran out. Get that first — do not assume:" >&2
        echo "" >&2
        echo "    $COMPOSE exec -T agent timeout 120 bash -c 'cd $CONTAINER_AGENT_DIR && bash -x <the script> 2>&1'" >&2
        echo "" >&2
        echo "  The last '+' line it prints is the command that hung. Common causes," >&2
        echo "  in the order they have actually occurred:" >&2
        echo "    - .env assigns a shell-reserved name (PWD, HOME, PATH). Sourcing it" >&2
        echo "      corrupts the shell itself and hangs something unrelated later." >&2
        echo "      scripts/load-env.sh now warns and ignores these; check the output." >&2
        echo "    - egress genuinely stalling through the mitmproxy/WireGuard chain." >&2
        echo "      Test with a LARGE body, not a small one — a fast index.json says" >&2
        echo "      nothing about a 30MB tarball:" >&2
        echo "      $COMPOSE exec -T agent curl -sS -m 120 -o /dev/null -w '%{speed_download}B/s\\n' https://nodejs.org/dist/index.tab" >&2
        echo "    - a step waiting on stdin it will never receive." >&2
        echo "" >&2
        echo "  Raise the bound with SETUP_TIMEOUT=<seconds> only once you know it is" >&2
        echo "  genuinely slow rather than stuck." >&2
        exit 124
    elif [ "$rc" -ne 0 ]; then
        echo "ERROR: '$label' failed (exit $rc)." >&2
        exit "$rc"
    fi
}

echo ""
echo "Installing system packages..."
run_setup_step "Installing system packages" \
    "DEBIAN_FRONTEND=noninteractive apt-get update -qq && \
     DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl jq git cron ca-certificates > /dev/null 2>&1 && \
     update-ca-certificates 2>/dev/null"

echo "Setting container timezone to $AGENT_TIMEZONE..."
run_setup_step "Setting container timezone" \
    "ln -sf /usr/share/zoneinfo/$AGENT_TIMEZONE /etc/localtime && \
     echo $AGENT_TIMEZONE > /etc/timezone"

echo "Running vm-setup.sh..."
run_setup_step "Running vm-setup.sh" \
    "for f in /etc/profile.d/sandcat-*.sh; do [ -r \"\$f\" ] && source \"\$f\"; done; \
     cd $CONTAINER_AGENT_DIR && \
     bash $CONTAINER_FRAMEWORK_DIR/scripts/vm-setup.sh"

echo "Installing framework dependencies..."
run_setup_step "Installing framework dependencies" \
    "for f in /etc/profile.d/sandcat-*.sh; do [ -r \"\$f\" ] && source \"\$f\"; done; \
     source ~/.nvm/nvm.sh && \
     cd $CONTAINER_FRAMEWORK_DIR && \
     npm install --production"

# ── Verify the runtime actually landed ────────────────────────────────────
# vm-setup.sh guards each install with `command -v`, so a step that half-ran
# can leave the container without node while every exit code is still 0. The
# agent is useless in that state — no cycles, no portal — so assert it here
# instead of discovering it hours later in supervisor.log.
echo "Verifying node, npm and claude are installed..."
if ! $COMPOSE exec -T agent timeout 60 bash -c \
    'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; \
     node --version && npm --version && claude --version' ; then
    echo "ERROR: setup reported success but the runtime is not usable in the container." >&2
    echo "  Inspect with:  $COMPOSE exec agent bash -c 'export NVM_DIR=\$HOME/.nvm; . \$NVM_DIR/nvm.sh; nvm ls'" >&2
    exit 1
fi

# ── Restart agent service for clean boot ──────────────────────────────────
echo ""
echo "Restarting agent service for clean boot..."
$COMPOSE restart agent

sleep 3

# ── Re-enable Tailscale serve ────────────────────────────────────────────
if [ "$HAS_TAILSCALE" = true ]; then
    echo "Re-enabling Tailscale serve on port $AGENT_PORT..."
    sudo tailscale serve --bg --https="$AGENT_PORT" "http://localhost:$AGENT_PORT" 2>/dev/null || {
        echo "Warning: Failed to re-enable Tailscale serve (continuing)" >&2
    }
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Sandcat stack for $AGENT_NAME is ready ==="
echo ""
echo "  NEXT STEP: Authenticate Claude:"
echo "    $COMPOSE exec agent bash -c 'source ~/.nvm/nvm.sh && claude'"
echo ""
echo "  Web portal:  http://localhost:$AGENT_PORT"
echo "  Status API:  curl http://localhost:$AGENT_PORT/api/status"
echo ""
echo "  Compose commands:"
echo "    $COMPOSE ps"
echo "    $COMPOSE logs agent --tail 50"
echo "    $COMPOSE exec agent bash"
echo ""
echo "  mitmproxy web UI (password in $STACK_DIR/.env):"
echo "    $COMPOSE port mitmproxy 8081"
