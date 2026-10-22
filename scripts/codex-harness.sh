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
FRAMEWORK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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
# Web search matches claude-code's default tools. `codex exec` rejects the
# interactive --search flag, so set the config key; charged per call on API-key
# billing, included with a ChatGPT plan.
CODEX_ARGS=(
  exec
  --json
  --dangerously-bypass-approvals-and-sandbox
  --skip-git-repo-check
  -C "$AGENT_DIR"
  -c model_reasoning_effort="high"
  -c tools.web_search=true
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

RUN_DIR="$(mktemp -d -t codex-harness.XXXXXX)"
EVENT_LOG="$RUN_DIR/events.jsonl"
FINAL_MESSAGE="$RUN_DIR/final.txt"
trap 'rm -rf "$RUN_DIR"' EXIT

# Keep diagnostics and the structured progress stream in the transcript. The
# final-message file preserves the stdout contract for reply consumers.
"$CODEX_BIN" "${CODEX_ARGS[@]}" "$@" --output-last-message "$FINAL_MESSAGE" - | tee "$EVENT_LOG" >&2
RC=${PIPESTATUS[0]}
[ ! -f "$FINAL_MESSAGE" ] || cat "$FINAL_MESSAGE"

# Tool output and agent prose can quote any error. Only lifecycle events say
# whether the turn completed; an error followed by completion was recovered.
if [ "$RC" -eq 0 ]; then
  node "$FRAMEWORK_DIR/scripts/codex-result.js" "$EVENT_LOG" || exit 1
fi

exit "$RC"
