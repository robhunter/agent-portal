#!/bin/bash
# scripts/codex-harness.sh — the framework's built-in Codex harness.
#
# read-harness-config.sh points HARNESS_CMD here when the selected harness is
# `codex` and the agent has no `harness.command` of its own. Callers pipe the
# prompt on stdin, exactly as they do for `claude --print`:
#     cat <prompt> | bash codex-harness.sh [extra `codex exec` flags]
#
# stdout carries only the agent's final message — telegram-respond.sh and
# consolidate-memory.sh capture it as the reply. Codex's progress log goes to
# stderr, which wake.sh folds into the cycle transcript.
#
# Exit codes: Codex's own, 2 when there is no Codex login, and 1 when Codex
# exited 0 after a swallowed error (so wake.sh's retry loop runs).

set -uo pipefail

AGENT_DIR="$(pwd)"
CODEX_BIN="${CODEX_BIN:-codex}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"

# Sandcat terminates TLS at mitmproxy. Codex is a Rust binary and ignores
# NODE_EXTRA_CA_CERTS; it reads CODEX_CA_CERTIFICATE instead.
SANDCAT_CA="/sandcat-certs/mitmproxy-ca-cert.pem"
if [ -z "${CODEX_CA_CERTIFICATE:-}" ] && [ -f "$SANDCAT_CA" ]; then
  export CODEX_CA_CERTIFICATE="$SANDCAT_CA"
fi

if [ ! -s "$CODEX_HOME_DIR/auth.json" ]; then
  echo "[codex-harness] ERROR: no $CODEX_HOME_DIR/auth.json — run 'codex login --device-auth' in this container first" >&2
  exit 2
fi

# Codex's own sandbox is off on purpose. Its Linux sandbox needs unprivileged
# user namespaces, which Docker Desktop's VM does not grant; the container and
# Sandcat's network boundary are the isolation, as for claude-code.
# Reasoning effort defaults low; `high` is the analogue of claude's --effort max.
CODEX_ARGS=(
  exec
  --dangerously-bypass-approvals-and-sandbox
  --skip-git-repo-check
  -C "$AGENT_DIR"
  -c model_reasoning_effort="high"
)

# MCP servers: Claude Code reads the agent's .mcp.json; Codex reads only
# config.toml, and ~/.codex is shared by every agent on the host. Translate the
# agent's stdio servers into per-run `-c mcp_servers.*` overrides instead.
if [ -f "$AGENT_DIR/.mcp.json" ] && command -v node >/dev/null 2>&1; then
  while IFS= read -r -d '' arg; do
    CODEX_ARGS+=(-c "$arg")
  done < <(node -e '
    const servers = JSON.parse(require("fs").readFileSync(process.argv[1], "utf-8")).mcpServers || {};
    const out = [];
    for (const [name, s] of Object.entries(servers)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name) || !s || typeof s.command !== "string") continue;
      const key = "mcp_servers." + name;
      out.push(key + ".command=" + JSON.stringify(s.command));
      if (Array.isArray(s.args)) out.push(key + ".args=" + JSON.stringify(s.args.map(String)));
      const env = Object.entries(s.env || {});
      if (env.length) out.push(key + ".env={" + env.map(([k, v]) => JSON.stringify(k) + "=" + JSON.stringify(String(v))).join(",") + "}");
    }
    process.stdout.write(out.map(a => a + "\0").join(""));
  ' "$AGENT_DIR/.mcp.json" 2>/dev/null)
fi

ERR_LOG="$(mktemp -t codex-harness.XXXXXX)"
trap 'rm -f "$ERR_LOG"' EXIT

# stderr goes through tee (kept for the check below); stdout bypasses the pipe
# on fd 3 so it stays the clean final message.
{ "$CODEX_BIN" "${CODEX_ARGS[@]}" "$@" - 2>&1 1>&3 3>&- | tee "$ERR_LOG" >&2; } 3>&1
RC=${PIPESTATUS[0]}

# Codex can end a run on a swallowed error and still exit 0; wake.sh only
# retries non-zero exits. Kept narrow, matching the fleethd wrappers: a false
# positive re-runs a healthy cycle.
if [ "$RC" -eq 0 ] && grep -qiE \
     "stream (error|disconnected)|rate limit(ed)? exceeded|usage limit reached|context (window )?exceeded|unexpected error occurred" \
     "$ERR_LOG"; then
  echo "[codex-harness] detected a swallowed error in codex output — exiting 1 so the caller retries" >&2
  exit 1
fi

exit "$RC"
