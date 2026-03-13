#!/bin/bash
#
# Entrypoint for agent containers running behind the Sandcat proxy.
# Installs mitmproxy CA cert, loads env vars and secret placeholders
# from sandcat.env, then delegates to the agent's own start.sh.
#
# Adapted from VirtusLab/sandcat app-init.sh:
#   - Removed vscode user handling (agents run as root)
#   - Removed mise/Java setup (handled by vm-setup.sh)
#   - Delegates to agent's start.sh instead of sleep infinity
#
set -e

AGENT_DIR="${1:?Usage: app-init.sh <agent-dir>}"

CA_CERT="/sandcat-certs/mitmproxy-ca-cert.pem"

# ── Install mitmproxy CA certificate ─────────────────────────────────────
# The CA cert is guaranteed to exist: agent depends_on wg-client (healthy),
# which depends_on mitmproxy (healthy), whose healthcheck requires the
# WireGuard config — generated after the CA.
if [ ! -f "$CA_CERT" ]; then
    echo "mitmproxy CA cert not found at $CA_CERT" >&2
    exit 1
fi

mkdir -p /usr/local/share/ca-certificates
cp "$CA_CERT" /usr/local/share/ca-certificates/mitmproxy.crt
# update-ca-certificates may not exist on first boot (ca-certificates is
# installed by docker-compose-create.sh setup step, then the container is
# restarted). The || true prevents set -e from killing the entrypoint.
# NODE_EXTRA_CA_CERTS (set below) handles Node.js regardless.
update-ca-certificates 2>/dev/null || true

# Node.js ignores the system trust store and bundles its own CA certs.
# Point it at the mitmproxy CA so TLS verification works for Node-based
# tools (e.g. Anthropic SDK, npm).
export NODE_EXTRA_CA_CERTS="$CA_CERT"
echo "export NODE_EXTRA_CA_CERTS=\"$CA_CERT\"" > /etc/profile.d/sandcat-node-ca.sh

# ── Disable git commit signing ───────────────────────────────────────────
# GPG keys are not available in the sandboxed container. Git env vars
# have the highest precedence, overriding system/global/local config.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="commit.gpgsign"
export GIT_CONFIG_VALUE_0="false"
cat > /etc/profile.d/sandcat-git.sh << 'GITEOF'
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="commit.gpgsign"
export GIT_CONFIG_VALUE_0="false"
GITEOF

# ── Source env vars and secret placeholders ──────────────────────────────
SANDCAT_ENV="/sandcat-certs/sandcat.env"
if [ -f "$SANDCAT_ENV" ]; then
    . "$SANDCAT_ENV"
    # Make vars available to new shells (e.g. subshells, cron-invoked
    # scripts) that won't inherit the entrypoint's environment.
    cp "$SANDCAT_ENV" /etc/profile.d/sandcat-env.sh
    count=$(grep -c '^export ' "$SANDCAT_ENV" 2>/dev/null || echo 0)
    echo "Loaded $count env var(s) from $SANDCAT_ENV"
else
    echo "WARNING: No $SANDCAT_ENV found — env vars and secret substitution disabled"
fi

# ── Source profile.d scripts from bash.bashrc ────────────────────────────
# Ensures env vars are available in non-login shells (e.g. framework
# subshells, cron-invoked scripts).
BASHRC_MARKER="# sandcat-profile-source"
if ! grep -q "$BASHRC_MARKER" /etc/bash.bashrc 2>/dev/null; then
    cat >> /etc/bash.bashrc << 'BASHRC_EOF'

# sandcat-profile-source
for _f in /etc/profile.d/sandcat-*.sh; do
    [ -r "$_f" ] && . "$_f"
done
unset _f
BASHRC_EOF
fi

# ── Delegate to the agent's existing start.sh ────────────────────────────
exec bash "${AGENT_DIR}/scripts/start.sh"
