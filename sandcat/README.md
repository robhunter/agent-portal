# Sandcat Secrets Isolation

Sandcat runs each agent in a three-container Docker Compose stack so the agent never holds real credentials. A mitmproxy sidecar holds secrets and substitutes placeholder values at the network layer, scoped to allowed destination hosts. A WireGuard tunnel with an iptables kill switch ensures all traffic goes through the proxy.

## Prerequisites

- Docker and Docker Compose v2.20+
- An agent repo with `agent.yaml` (see `agent.yaml.example` in the framework root)

## Quick Start

### 1. Create the settings file

From your agent repo directory (the one containing `agent.yaml`):

```bash
bash ../agent-portal/sandcat/scripts/create-settings.sh .
```

This creates `~/sandcat-secrets/<agent-name>/settings.json` with a template. If the agent has a `.env` file, tokens and API keys are placed in the secrets section and git identity vars are carried over to the env section.

Edit the file and replace placeholder values with real credentials.

### 2. Launch the stack

```bash
bash ../agent-portal/scripts/docker-compose-create.sh .
```

This generates a Docker Compose stack at `~/sandcat-stacks/<agent-name>/`, builds the containers, installs dependencies, and starts everything.

### 3. Authenticate Claude

```bash
docker compose -f ~/sandcat-stacks/<agent-name>/docker-compose.yml \
  exec agent bash -c 'source ~/.nvm/nvm.sh && claude'
```

## settings.json Reference

The settings file lives on the host at `~/sandcat-secrets/<agent-name>/settings.json`. It is mounted read-only into the mitmproxy container and never into the agent container.

```json
{
  "env": {
    "GIT_AUTHOR_NAME": "my-agent",
    "GIT_AUTHOR_EMAIL": "my-agent@example.com",
    "GIT_COMMITTER_NAME": "my-agent",
    "GIT_COMMITTER_EMAIL": "my-agent@example.com"
  },
  "secrets": {
    "GH_TOKEN": {
      "value": "ghp_real_token_here",
      "hosts": ["github.com", "*.github.com"]
    }
  },
  "network": [
    {"action": "allow", "host": "github.com"},
    {"action": "allow", "host": "*.github.com"},
    {"action": "allow", "host": "*.anthropic.com"},
    {"action": "allow", "host": "*.claude.ai"},
    {"action": "allow", "host": "*", "method": "GET"}
  ]
}
```

### env

Non-secret environment variables passed through to the agent as-is. Git identity is not a secret — it is public in every commit.

### secrets

Each key is an env var name. `value` is the real credential. `hosts` is a list of glob patterns for destination hosts that may receive this credential. The agent sees `SANDCAT_PLACEHOLDER_<NAME>` instead of the real value.

### network

Outbound HTTP/S firewall rules. Evaluated top-to-bottom, first match wins, default deny. `host` supports glob patterns. Optional `method` field restricts to a specific HTTP method. The `GET *` rule lets the agent read any website while restricting writes to explicitly allowed hosts.

## Verification

After launching, verify the setup from inside the agent container:

```bash
COMPOSE="docker compose -f ~/sandcat-stacks/<agent-name>/docker-compose.yml"

# All three containers healthy
$COMPOSE ps

# Env var is a placeholder, not a real token
$COMPOSE exec agent bash -c 'source /etc/profile.d/sandcat-env.sh && echo $GH_TOKEN'
# Expected: SANDCAT_PLACEHOLDER_GH_TOKEN

# GitHub auth works through the proxy
$COMPOSE exec agent bash -c 'source /etc/profile.d/sandcat-env.sh && source ~/.nvm/nvm.sh && gh auth status'

# Leak detection blocks secrets to unauthorized hosts
$COMPOSE exec agent bash -c 'source /etc/profile.d/sandcat-env.sh && curl -s -H "Authorization: token $GH_TOKEN" https://httpbin.org/headers'
# Expected: 403 Blocked

# Portal accessible
curl -s http://localhost:<agent-port>/api/status | head -c 200
```

## Credential Rotation

1. Edit `~/sandcat-secrets/<agent-name>/settings.json` with the new value
2. Restart mitmproxy: `docker compose -f ~/sandcat-stacks/<agent-name>/docker-compose.yml restart mitmproxy`
3. The agent container does not need a restart — it still has the same placeholder and mitmproxy now substitutes the new value

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `gh auth status` fails | GH_TOKEN not in secrets, or github.com not in hosts | Check settings.json |
| `curl` to external site returns 403 | Host not in network rules | Add host to network rules, restart mitmproxy |
| Agent container won't start | wg-client not healthy | Check `docker compose logs wg-client` |
| Portal not accessible | Port exposed on wg-client, not agent | Check compose file port mapping |
| `git push` fails | github.com not in GH_TOKEN hosts | Fix settings.json, restart mitmproxy |
| npm install fails | registry.npmjs.org not allowed | Add `*.npmjs.org` to network rules or rely on the GET * rule |
| Claude auth fails | *.anthropic.com not in network rules | Add to network rules |

## Rollback

To return to the single-container setup:

```bash
# Stop the Sandcat stack
docker compose -f ~/sandcat-stacks/<agent-name>/docker-compose.yml down

# Restore the .env file and use the pre-Sandcat docker-create.sh from git history
```
