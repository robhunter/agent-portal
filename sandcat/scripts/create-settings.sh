#!/bin/bash
#
# sandcat/scripts/create-settings.sh — Create a template settings.json for
# Sandcat secrets isolation.
#
# Usage: create-settings.sh <agent-dir>
#
# Reads agent.yaml to determine the agent name, then creates
# ~/sandcat-secrets/<agent-name>/settings.json with a template that you
# fill in with real secret values.
#
# If the agent directory contains a .env file, secret-shaped variables
# (tokens, API keys) are placed in the secrets section and non-secret
# variables (git identity, config flags) go in the env section.
#
set -e

AGENT_DIR="${1:?Usage: create-settings.sh <agent-dir>}"
AGENT_DIR="$(cd "$AGENT_DIR" && pwd)"

if [ ! -f "$AGENT_DIR/agent.yaml" ]; then
    echo "ERROR: No agent.yaml found in $AGENT_DIR" >&2
    exit 1
fi

# ── Read agent name from agent.yaml ──────────────────────────────────────
_yaml_value() {
    grep "^${1}:" "$AGENT_DIR/agent.yaml" \
        | sed 's/^[^:]*:[[:space:]]*//' \
        | sed "s/[[:space:]]*#.*//" \
        | sed "s/^[\"']//" \
        | sed "s/[\"']$//" \
        | sed 's/[[:space:]]*$//'
}

AGENT_NAME=$(_yaml_value name)

if [ -z "$AGENT_NAME" ]; then
    echo "ERROR: Could not read 'name' from $AGENT_DIR/agent.yaml" >&2
    exit 1
fi

SETTINGS_DIR="$HOME/sandcat-secrets/$AGENT_NAME"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

if [ -f "$SETTINGS_FILE" ]; then
    echo "ERROR: $SETTINGS_FILE already exists." >&2
    echo "  Remove it first if you want to regenerate." >&2
    exit 1
fi

# ── Parse .env if it exists ──────────────────────────────────────────────
ENV_VARS=""      # JSON object entries for "env" section
SECRET_VARS=""   # JSON object entries for "secrets" section
SECRETS_TO_FILL=()

_json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

_is_secret_name() {
    case "$1" in
        *_TOKEN|*_KEY|*_SECRET|*_PASSWORD) return 0 ;;
        *) return 1 ;;
    esac
}

_default_hosts() {
    case "$1" in
        GH_TOKEN)       echo '["github.com", "*.github.com"]' ;;
        GEMINI_API_KEY) echo '["*.googleapis.com", "generativelanguage.googleapis.com"]' ;;
        *)              echo '[]' ;;
    esac
}

_is_git_identity() {
    case "$1" in
        GIT_AUTHOR_NAME|GIT_AUTHOR_EMAIL|GIT_COMMITTER_NAME|GIT_COMMITTER_EMAIL) return 0 ;;
        *) return 1 ;;
    esac
}

ENV_FILE="$AGENT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
    echo "Found $ENV_FILE — extracting variables..."
    echo ""

    while IFS= read -r line; do
        # Skip comments and blank lines
        case "$line" in
            \#*|"") continue ;;
        esac

        key="${line%%=*}"
        value="${line#*=}"
        # Strip surrounding quotes from value
        value=$(echo "$value" | sed "s/^[\"']//" | sed "s/[\"']$//")

        if _is_secret_name "$key"; then
            hosts=$(_default_hosts "$key")
            if [ -n "$SECRET_VARS" ]; then SECRET_VARS="$SECRET_VARS,"; fi
            SECRET_VARS="$SECRET_VARS
    \"$key\": {
      \"value\": \"<paste $key value from .env>\",
      \"hosts\": $hosts
    }"
            SECRETS_TO_FILL+=("$key")
        else
            escaped=$(_json_escape "$value")
            if [ -n "$ENV_VARS" ]; then ENV_VARS="$ENV_VARS,"; fi
            ENV_VARS="$ENV_VARS
    \"$key\": \"$escaped\""
        fi
    done < "$ENV_FILE"
else
    echo "No .env file found — writing generic template."
    echo ""

    ENV_VARS='
    "GIT_AUTHOR_NAME": "<your-git-username>",
    "GIT_AUTHOR_EMAIL": "<your-git-email>",
    "GIT_COMMITTER_NAME": "<your-git-username>",
    "GIT_COMMITTER_EMAIL": "<your-git-email>"'

    SECRET_VARS='
    "GH_TOKEN": {
      "value": "<paste your GitHub token here>",
      "hosts": ["github.com", "*.github.com"]
    }'
    SECRETS_TO_FILL+=("GH_TOKEN")
fi

# ── Write settings.json ─────────────────────────────────────────────────
mkdir -p "$SETTINGS_DIR"
chmod 700 "$SETTINGS_DIR"

cat > "$SETTINGS_FILE" << JSONEOF
{
  "env": {$ENV_VARS
  },
  "secrets": {$SECRET_VARS
  },
  "network": [
    {"action": "allow", "host": "github.com"},
    {"action": "allow", "host": "*.github.com"},
    {"action": "allow", "host": "*.anthropic.com"},
    {"action": "allow", "host": "*.claude.ai"},
    {"action": "allow", "host": "*", "method": "GET"}
  ]
}
JSONEOF

chmod 600 "$SETTINGS_FILE"

# ── Summary ──────────────────────────────────────────────────────────────
echo "Created $SETTINGS_FILE"
echo ""

if [ ${#SECRETS_TO_FILL[@]} -gt 0 ]; then
    echo "NEXT: Edit the file and replace placeholder values for:"
    for s in "${SECRETS_TO_FILL[@]}"; do
        echo "  - $s"
    done
    echo ""
fi

echo "  If your agent needs additional secrets (API keys, tokens), add them"
echo "  to the \"secrets\" section with their allowed hosts."
echo ""
echo "  If your agent needs to POST/PUT to hosts beyond github.com, add"
echo "  rules to the \"network\" section. GET requests to any host are"
echo "  allowed by default."
echo ""
echo "Then run the stack:"
echo "  bash scripts/docker-compose-create.sh $AGENT_DIR"
