# Agent Portal

Shared web portal for autonomous agents. Config-driven — each agent provides a `portal.config.json` that controls which tabs, routes, and sidebar features are active.

Zero external dependencies. Uses Node built-in modules only (marked.js loaded from CDN in the browser).

## Installation

Agent Portal is deployed as a git-pulled workspace — the same pattern used for `claude-tools` and other shared repos.

### 1. Clone the repo

In your container, clone into `/root/workspaces/agent-portal`:

```bash
mkdir -p /root/workspaces
git clone "https://${GH_TOKEN}@github.com/your-org/agent-portal.git" /root/workspaces/agent-portal
```

### 2. Create your config file

Copy the example config for your agent and save it in your agent directory:

```bash
cp /root/workspaces/agent-portal/examples/coder.config.json /root/agent-coder/portal.config.json
```

Edit the config to match your agent's environment. See [Configuration](#configuration) below for all options.

### 3. Update `scripts/start.sh`

Replace the old portal-server.js supervisor line with agent-portal. Change this:

```bash
supervise "portal-server" node scripts/portal-server.js
```

To this:

```bash
# Pull latest portal code on startup
git -C /root/workspaces/agent-portal pull --ff-only 2>/dev/null || true

# Start the shared portal
supervise "portal-server" node /root/workspaces/agent-portal/index.js /root/agent-coder/portal.config.json
```

Adjust the config path to match your agent directory (e.g., `/root/agent-pm/portal.config.json`).

The `pidFile` in your config should match the PID file your supervisor expects. The portal writes its PID to this file on startup and cleans it up on exit, so the existing supervisor restart logic will work unchanged.

### 4. Verify

Restart the container or kill the old portal-server process. The supervisor will start agent-portal automatically. Confirm it's working:

```bash
curl -s http://localhost:<port>/api/status | head -c 200
curl -s http://localhost:<port>/ | head -c 100
```

You should see JSON status from the first and `<!DOCTYPE html>` from the second.

### 5. Clean up

Once verified, the old `scripts/portal-server.js` can be removed. It is no longer needed.

## Secrets Isolation

For production deployments, agents can run behind a Sandcat proxy that keeps real credentials out of the agent container. See [`sandcat/README.md`](sandcat/README.md) for setup instructions.

## Updating

To update the portal, pull the latest code in the workspace:

```bash
git -C /root/workspaces/agent-portal pull --ff-only
```

Then restart the portal process (kill the old PID or restart the container). If you added the `git pull` to `start.sh` as shown above, updates happen automatically on every container restart.

## Configuration

Each agent has a `portal.config.json` with these fields:

### Required

| Field | Description | Example |
|-------|-------------|---------|
| `name` | Agent display name | `"Coder"` |
| `port` | HTTP port to listen on | `8082` |
| `agentDir` | Absolute path to agent state directory | `"/root/agent-coder"` |
| `cronFile` | Path to agent's cron file | `"/etc/cron.d/agent-coder"` |
| `lockFile` | Path to cycle lock file | `"/tmp/agent-coder.lock"` |
| `pidFile` | Path to portal PID file | `"/tmp/agent-coder-portal-server.pid"` |
| `authors` | Map of author names to `{ color, bg }` for badge styling | See examples |

### Features

The `features` object controls which tabs and routes are enabled. Omit a key to disable it.

| Field | Type | Description |
|-------|------|-------------|
| `tabs` | `string[]` | Tab order. Default: `["journal", "status"]`. Available: `journal`, `status`, `github`, `roadmap`, `health`, `requests`, `outputs`, `project` |
| `github` | `{ repos: string[] }` | Enable GitHub tab with repo list |
| `roadmap` | `true` | Enable roadmap tab (reads `roadmap.md` from agentDir) |
| `health` | `true` | Enable health tab (reads `health.yaml` from agentDir) |
| `requests` | `true` | Enable requests tab (reads/writes `requests.yaml`) |
| `outputs` | `true` | Enable outputs tab (reads `output/` directory in agentDir) |
| `feedback` | `true` | Enable feedback routes (reads/writes `input/feedback/` in agentDir) |
| `deploy` | `true` | Enable deploy signal route (writes signal file for supervisor) |
| `serviceRestart` | `string[]` | Allowlist of service names that can be restarted via API |

### Sidebar

The `sidebar` object controls the sidebar layout.

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"simple"` or `"projects"` | Simple shows status dot + cron controls. Projects shows a project list sidebar. Default: `"simple"` |
| `projectsDir` | `string` | Subdirectory of agentDir containing project `.md` files (when type is `"projects"`) |
| `runningLog` | `true` | Show "Running Log" entry in project sidebar for cross-project journal |

## Example Configs

See `examples/` for complete configs:

- `coder.config.json` — Simple sidebar, GitHub tab
- `pm.config.json` — Simple sidebar, GitHub + roadmap + health + requests tabs
- `bobbo.config.json` — Project sidebar, outputs + feedback + deploy

## Directory Structure

Agent Portal expects the following structure in `agentDir`:

```
agentDir/
├── journals/          # Monthly journal files (YYYY-MM.md)
├── logs/
│   └── events.jsonl   # Cycle events
├── today.md           # Current priorities (optional)
├── roadmap.md         # Roadmap content (if features.roadmap)
├── health.yaml        # Health data (if features.health)
├── requests.yaml      # Requests data (if features.requests)
├── output/            # Output files (if features.outputs)
├── input/
│   └── feedback/      # Feedback YAML files (if features.feedback)
└── projects/          # Project .md files (if sidebar.type is "projects")
```

## Development

```bash
node --test test/*.test.js
```

171 tests, zero external dependencies.
