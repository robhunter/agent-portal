const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');

const AGENT_FILE_SOURCES = [
  { id: 'claude-md', label: 'Identity', rel: 'CLAUDE.md' },
  { id: 'persona', label: 'Persona', rel: path.join('memory', 'persona.yaml') },
  { id: 'values', label: 'Values', rel: path.join('memory', 'values.yaml') },
];

const AGENT_PROMPT_SOURCES = [
  { id: 'wake-prompt', label: 'Wake prompt', key: 'wake-prompt' },
  { id: 'respond-prompt', label: 'Respond prompt', key: 'respond-prompt' },
];

const INSTRUCTION_ORDER = ['claude-md', 'wake-prompt', 'respond-prompt', 'persona', 'values'];

function resolveFrameworkDir(config) {
  if (config && config.frameworkDir) return config.frameworkDir;
  return path.resolve(__dirname, '..');
}

function readInstructions(agentDir, frameworkDir) {
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

function commitFile(agentDir, relPath, message) {
  try {
    execFileSync('git', ['-C', agentDir, 'add', '--', relPath], { timeout: 10000, stdio: 'ignore' });
    execFileSync('git', ['-C', agentDir, 'commit', '-m', message, '--', relPath], { timeout: 10000, stdio: 'ignore' });
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

module.exports = {
  AGENT_FILE_SOURCES,
  AGENT_PROMPT_SOURCES,
  INSTRUCTION_ORDER,
  resolveFrameworkDir,
  readInstructions,
  findEditable,
  writeInstruction,
  buildAgentYaml,
};
