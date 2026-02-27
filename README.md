# Agent Portal

Shared web portal for autonomous agents. Config-driven — each agent provides a `portal.config.json` that controls which tabs, routes, and sidebar features are active.

## Usage

```bash
agent-portal portal.config.json
```

## Requirements

- Node.js >= 18
- Zero external dependencies (uses Node built-in modules only)
- Markdown rendered client-side via marked.js from CDN

## Development

```bash
npm test
```
