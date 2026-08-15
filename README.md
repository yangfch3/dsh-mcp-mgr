# dsh-mcp-mgr

English | [中文](README.zh.md)

A workspace-level MCP manager for DeepSeek Harness: declare MCP servers in each workspace's `.dsh/dshmm/mcp.json` (Claude/Codex-style `mcpServers` format), auto-discovered and dynamically registered as dsh plugin instances, with a management UI in the settings page.

## Features

- **Workspace MCP**: auto-discovers `mcp.json` under every registered workspace, hot-syncs on file changes, and unloads on workspace removal
- **Profile MCP display**: unified display and management of non-workspace mcp-client registrations (profile patch / bundle / `--patch`)
- **Settings tab**: MCP server list — source, status, inspect and remove
- Workspace MCP servers are registered under dsh's standard `mcp__<serverName>__<tool>` naming, so multiple servers and sources are naturally isolated

## Install & uninstall

Install:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-mcp-mgr
```

Start:

```sh
npx @deepseek-ai/dsh web
```

Uninstall:

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-mcp-mgr
```

## Workspace configuration

The plugin auto-detects `.dsh/dshmm/mcp.json` at the workspace root, for example:

```json
{
  "mcpServers": {
    "unity-mcp": { "type": "http", "url": "http://localhost:8090/" },
    "filesystem": { "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"] }
  }
}
```

- A missing `type` is treated as remote Streamable HTTP; `${VAR}` environment expansion is supported
- The stdio server's cwd defaults to the workspace root
- `serverName` must be globally unique; a later duplicate fails loudly (flagged as a conflict in the UI)

## Development

Build:

```sh
# host plugin
tsc -p packages/dsh-mcp-mgr && node gen.mjs

# UI plugin (from the ui package directory)
tsc -p packages/dsh-mcp-mgr-ui && tsdown --config-loader tsx --env.DSH_BUILD_FACE client

# regression
node verify.mjs
```

Local (source) install verification and uninstall:

```sh
# install
node scripts/install.mjs

# uninstall
node scripts/uninstall.mjs
```

Design docs live in `Doc/requirements.md`.
