# dsh-mcp-mgr

English | [中文](README.zh.md)

A workspace-level MCP manager for DeepSeek Harness: declare MCP servers in each workspace's `.dsh/dshmm/mcp.json` (Claude/Codex-style `mcpServers` format), auto-discovered and dynamically registered as dsh plugin instances, with a management UI in the settings page.

## Features

- **Workspace MCP**: auto-discovers `mcp.json` under every registered workspace, hot-syncs on file changes, and unloads on workspace removal
- **Profile MCP display**: read-only view of mcp-client registrations from the config tree (profile patch / bundle / `--patch`), with real status, cross-source conflict hints, and one-click opening of the source file
- **Settings tab**: server list (status badges, source labels, self-sizing table); workspace-sourced servers can be removed, config-sourced ones can be inspected
- Tools are registered as `mcp__<serverName>__<tool>`, so multiple servers and sources are naturally isolated

## Install

```sh
dsh plugin --profile web add dsh-mcp-mgr
```

> Requires a dsh CLI installation and an initialized target profile.

Uninstall: `dsh plugin --profile web remove dsh-mcp-mgr`

## Workspace configuration

`.dsh/dshmm/mcp.json` at the workspace root:

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
node scripts/install.mjs

# uninstall: node scripts/uninstall.mjs
```

Design docs live in `Doc/requirements.md`.
