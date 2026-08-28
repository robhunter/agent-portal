const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');

const AGENT_FILE_SOURCES = [
  { id: 'claude-md', label: 'Core', rel: 'CLAUDE.md' },
  { id: 'agents-md', label: 'Agents', rel: 'AGENTS.md' },
  { id: 'persona', label: 'Persona', rel: path.join('memory', 'persona.yaml') },
  { id: 'values', label: 'Values', rel: path.join('memory', 'values.yaml') },
];

const AGENT_PROMPT_SOURCES = [
  { id: 'wake-prompt', label: 'Wake prompt', key: 'wake-prompt' },
  { id: 'respond-prompt', label: 'Respond prompt', key: 'respond-prompt' },
];

const INSTRUCTION_ORDER = ['claude-md', 'agents-md', 'wake-prompt', 'respond-prompt', 'persona', 'values'];

function resolveFrameworkDir(config) {
  if (config && config.frameworkDir) return config.frameworkDir;
  return path.resolve(__dirname, '..');
}

function resolveGlobalClaudeMd(config) {
  if (config && Object.prototype.hasOwnProperty.call(config, 'globalInstructionsFile')) {
    return config.globalInstructionsFile;
  }
  return path.join(os.homedir(), '.claude', 'CLAUDE.md');
}

function readInstructions(agentDir, frameworkDir, globalClaudeMd) {
  const out = [];

  for (const src of AGENT_FILE_SOURCES) {
    const filePath = path.join(agentDir, src.rel);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      out.push({
        id: src.id,
        label: src.label,
        source: src.rel,
        scope: 'agent',
        editable: true,
        bytes: stat.size,
        modified: stat.mtime.toISOString(),
        content: fs.readFileSync(filePath, 'utf-8'),
      });
    } catch {}
  }

  try {
    const agentYaml = path.join(agentDir, 'agent.yaml');
    const stat = fs.statSync(agentYaml);
    const doc = yaml.load(fs.readFileSync(agentYaml, 'utf-8')) || {};
    for (const src of AGENT_PROMPT_SOURCES) {
      const value = doc[src.key];
      if (typeof value !== 'string' || value.trim() === '') continue;
      out.push({
        id: src.id,
        label: src.label,
        source: 'agent.yaml → ' + src.key,
        scope: 'agent',
        editable: true,
        bytes: Buffer.byteLength(value, 'utf-8'),
        modified: stat.mtime.toISOString(),
        content: value,
      });
    }
  } catch {}

  if (globalClaudeMd) {
    try {
      const stat = fs.statSync(globalClaudeMd);
      if (stat.isFile()) {
        out.push({
          id: 'shared-global-claude-md',
          label: 'Global',
          source: path.join('~', '.claude', 'CLAUDE.md'),
          scope: 'shared',
          editable: false,
          bytes: stat.size,
          modified: stat.mtime.toISOString(),
          content: fs.readFileSync(globalClaudeMd, 'utf-8'),
        });
      }
    } catch {}
  }

  try {
    const sharedDir = path.join(frameworkDir, 'instructions');
    const files = fs.readdirSync(sharedDir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort();
    for (const f of files) {
      try {
        const filePath = path.join(sharedDir, f);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        out.push({
          id: 'shared-' + f.replace(/\.md$/, ''),
          label: f.replace(/\.md$/, '').replace(/-/g, ' '),
          source: path.join('instructions', f),
          scope: 'shared',
          editable: false,
          bytes: stat.size,
          modified: stat.mtime.toISOString(),
          content: fs.readFileSync(filePath, 'utf-8'),
        });
      } catch {}
    }
  } catch {}

  out.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'agent' ? -1 : 1;
    const ai = INSTRUCTION_ORDER.indexOf(a.id);
    const bi = INSTRUCTION_ORDER.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    if (a.id === 'shared-global-claude-md') return -1;
    if (b.id === 'shared-global-claude-md') return 1;
    return a.source.localeCompare(b.source);
  });

  return out;
}

function findEditable(id) {
  const file = AGENT_FILE_SOURCES.find(s => s.id === id);
  if (file) return { kind: 'file', rel: file.rel, label: file.label };
  const prompt = AGENT_PROMPT_SOURCES.find(s => s.id === id);
  if (prompt) return { kind: 'prompt', key: prompt.key, rel: 'agent.yaml', label: prompt.label };
  return null;
}

function writeAtomic(filePath, content) {
  const tmp = filePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, content, 'utf-8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function buildAgentYaml(rawYaml, key, value) {
  const before = yaml.load(rawYaml);
  if (!before || typeof before !== 'object' || Array.isArray(before)) {
    throw new Error('agent.yaml did not parse as a mapping');
  }
  const keysBefore = Object.keys(before);
  const next = Object.assign({}, before, { [key]: value });
  const dumped = yaml.dump(next, { lineWidth: -1 });

  let reloaded;
  try {
    reloaded = yaml.load(dumped);
  } catch (err) {
    throw new Error('result would not parse as YAML: ' + err.message);
  }
  if (!reloaded || typeof reloaded !== 'object' || Array.isArray(reloaded)) {
    throw new Error('result would not parse as a mapping');
  }
  for (const k of keysBefore) {
    if (!(k in reloaded)) throw new Error('write would drop key: ' + k);
  }
  if (reloaded[key] !== value) {
    throw new Error('value did not survive a YAML round trip');
  }
  return dumped;
}

const FALLBACK_IDENTITY = [
  '-c', 'user.name=agent-portal',
  '-c', 'user.email=agent-portal@localhost',
];

function commitFile(agentDir, relPath, message) {
  try {
    execFileSync('git', ['-C', agentDir, 'add', '--', relPath], { timeout: 10000, stdio: 'ignore' });
  } catch {
    return false;
  }
  const commit = (extra) => execFileSync(
    'git',
    ['-C', agentDir].concat(extra, ['commit', '-m', message, '--', relPath]),
    { timeout: 10000, stdio: 'ignore' },
  );
  try {
    commit([]);
    return true;
  } catch {}
  try {
    commit(FALLBACK_IDENTITY);
    return true;
  } catch {
    return false;
  }
}

function writeInstruction(agentDir, id, content) {
  const target = findEditable(id);
  if (!target) {
    const err = new Error('Not editable: ' + id);
    err.statusCode = 403;
    throw err;
  }
  if (typeof content !== 'string') {
    const err = new Error('content must be a string');
    err.statusCode = 400;
    throw err;
  }

  const filePath = path.join(agentDir, target.rel);

  if (target.kind === 'prompt') {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      const err = new Error('agent.yaml not found');
      err.statusCode = 400;
      throw err;
    }
    let dumped;
    try {
      dumped = buildAgentYaml(raw, target.key, content);
    } catch (e) {
      const err = new Error('Refused to write: ' + e.message);
      err.statusCode = 400;
      throw err;
    }
    writeAtomic(filePath, dumped);
  } else {
    writeAtomic(filePath, content);
  }

  const committed = commitFile(agentDir, target.rel, 'portal: update ' + target.label);
  const stat = fs.statSync(filePath);
  return { modified: stat.mtime.toISOString(), committed, source: target.rel };
}

const HISTORY_SCAN_LIMIT = 200;

function gitLines(agentDir, args) {
  try {
    const out = execFileSync('git', ['-C', agentDir].concat(args), {
      encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function commitList(agentDir, relPath, follow, limit) {
  const args = ['log', '--format=%H%x00%aI%x00%s', '-n', String(limit)];
  if (follow) args.push('--follow');
  args.push('--', relPath);
  const lines = gitLines(agentDir, args);
  if (!lines) return [];
  return lines.map(l => {
    const [sha, date, subject] = l.split('\u0000');
    return { sha, date, message: subject || '' };
  }).filter(c => c.sha);
}

function blobAt(agentDir, sha, relPath) {
  try {
    return execFileSync('git', ['-C', agentDir, 'show', sha + ':' + relPath], {
      encoding: 'utf-8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function promptAt(agentDir, sha, key) {
  const raw = blobAt(agentDir, sha, 'agent.yaml');
  if (raw == null) return null;
  try {
    const doc = yaml.load(raw);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    const v = doc[key];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function instructionHistory(agentDir, id, limit) {
  const target = findEditable(id);
  if (!target) return [];
  const cap = limit || 50;

  if (target.kind === 'file') {
    return commitList(agentDir, target.rel, true, cap).map(c => {
      const body = blobAt(agentDir, c.sha, target.rel);
      return Object.assign({}, c, { bytes: body == null ? null : Buffer.byteLength(body, 'utf-8') });
    });
  }

  const commits = commitList(agentDir, 'agent.yaml', false, HISTORY_SCAN_LIMIT);
  const values = commits.map(c => promptAt(agentDir, c.sha, target.key));
  const out = [];
  for (let i = 0; i < commits.length; i++) {
    const value = values[i];
    if (value == null) continue;
    const older = i + 1 < values.length ? values[i + 1] : null;
    if (value === older) continue;
    out.push(Object.assign({}, commits[i], { bytes: Buffer.byteLength(value, 'utf-8') }));
    if (out.length >= cap) break;
  }
  return out;
}

function instructionAtRevision(agentDir, id, sha) {
  const target = findEditable(id);
  if (!target) return null;
  if (!/^[0-9a-fA-F]{4,64}$/.test(sha)) return null;
  if (target.kind === 'file') return blobAt(agentDir, sha, target.rel);
  return promptAt(agentDir, sha, target.key);
}

module.exports = {
  AGENT_FILE_SOURCES,
  AGENT_PROMPT_SOURCES,
  INSTRUCTION_ORDER,
  resolveFrameworkDir,
  resolveGlobalClaudeMd,
  readInstructions,
  findEditable,
  writeInstruction,
  buildAgentYaml,
  instructionHistory,
  instructionAtRevision,
};
