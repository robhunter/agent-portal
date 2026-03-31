// routes/capabilities.js — /api/capabilities
// Returns MCP servers, scripts/tools, and skills available to the agent

const fs = require('fs');
const path = require('path');
const { sendJSON } = require('../helpers');

function readMCPServers(agentDir, workspaces) {
  const servers = [];

  // Check agent dir for .mcp.json
  const agentMcp = path.join(agentDir, '.mcp.json');
  try {
    if (fs.existsSync(agentMcp)) {
      const data = JSON.parse(fs.readFileSync(agentMcp, 'utf-8'));
      if (data.mcpServers) {
        for (const [name, cfg] of Object.entries(data.mcpServers)) {
          servers.push({ name, source: 'agent', ...cfg });
        }
      }
    }
  } catch {}

  // Check each workspace for .mcp.json
  if (Array.isArray(workspaces)) {
    for (const ws of workspaces) {
      const wsPath = ws.path || ws;
      const wsMcp = path.join(wsPath, '.mcp.json');
      try {
        if (fs.existsSync(wsMcp)) {
          const data = JSON.parse(fs.readFileSync(wsMcp, 'utf-8'));
          if (data.mcpServers) {
            for (const [name, cfg] of Object.entries(data.mcpServers)) {
              // Avoid duplicates
              if (!servers.some(s => s.name === name)) {
                servers.push({ name, source: path.basename(wsPath), ...cfg });
              }
            }
          }
        }
      } catch {}
    }
  }

  return servers;
}

function readScripts(agentDir) {
  const scripts = [];
  const toolsDir = path.join(agentDir, 'tools');
  try {
    const files = fs.readdirSync(toolsDir).filter(f => !f.startsWith('.'));
    for (const f of files) {
      const filePath = path.join(toolsDir, f);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        // Read first line for description (shebang or comment)
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        let description = '';
        for (const line of lines.slice(0, 5)) {
          if (line.startsWith('#') && !line.startsWith('#!')) {
            description = line.replace(/^#+\s*/, '').trim();
            break;
          }
        }
        scripts.push({
          name: f,
          size: stat.size,
          description,
        });
      }
    }
  } catch {}
  return scripts;
}

function readSkills(agentDir) {
  const skills = [];
  const skillsDir = path.join(agentDir, 'skills');
  try {
    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md') && !f.startsWith('.'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(skillsDir, f), 'utf-8');
      const name = f.replace('.md', '').replace(/-/g, ' ');
      // Extract first heading or "When to use" section
      let description = '';
      const headingMatch = content.match(/^# (.+)$/m);
      if (headingMatch) {
        description = headingMatch[1].replace(/^Skill:\s*/i, '').trim();
      }
      // Extract "When to use" content
      let whenToUse = '';
      const whenMatch = content.match(/## When to use\n([\s\S]*?)(?=\n##|\n$)/);
      if (whenMatch) {
        whenToUse = whenMatch[1].trim().split('\n').map(l => l.replace(/^- /, '').trim()).filter(Boolean).join('; ');
      }
      skills.push({ name, filename: f, description, whenToUse });
    }
  } catch {}
  return skills;
}

function readWorkspaces(agentDir) {
  const workspaces = [];
  const agentYaml = path.join(agentDir, 'agent.yaml');
  try {
    if (fs.existsSync(agentYaml)) {
      const content = fs.readFileSync(agentYaml, 'utf-8');
      // Simple YAML parsing for workspaces array
      const wsMatch = content.match(/^workspaces:\n((?:\s+-[\s\S]*?)(?=\n\w|\n$))/m);
      if (wsMatch) {
        const entries = wsMatch[1].split(/\n\s+-\s+/).filter(Boolean);
        for (const entry of entries) {
          const repoMatch = entry.match(/repo:\s*(.+)/);
          const pathMatch = entry.match(/path:\s*(.+)/);
          if (repoMatch) {
            workspaces.push({
              repo: repoMatch[1].trim(),
              path: pathMatch ? pathMatch[1].trim() : '',
            });
          }
        }
      }
    }
  } catch {}
  return workspaces;
}

function register(routes, config) {
  // Always register — capabilities are discovered from agent directory

  const agentDir = config.agentDir || '.';

  routes['GET /api/capabilities'] = (req, res) => {
    const workspaces = readWorkspaces(agentDir);
    const data = {
      mcpServers: readMCPServers(agentDir, workspaces),
      scripts: readScripts(agentDir),
      skills: readSkills(agentDir),
      workspaces,
    };
    sendJSON(res, 200, data);
  };
}

module.exports = { register };
