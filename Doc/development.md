# dsh-mcp-mgr Source Developer Guide

English | [中文](development.zh.md)

Use this workflow when modifying both deepseek-harness and this plugin from source. The two repositories may be anywhere; they do not need to be siblings or use fixed paths.

## 1. Configure the harness source once

Replace the placeholder with the absolute path of the deepseek-harness source checkout and run this once:

```powershell
[Environment]::SetEnvironmentVariable('DSH_HARNESS_ROOT', '<deepseek-harness-source-root>', 'User')
```

Open a new terminal afterwards. This variable is used only by local profile install/uninstall; it is not used by this repository's build or regression commands.

## 2. Build this plugin

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm install
pnpm run check
```

`check` includes the host/client builds, Typert generation, and `verify` regression.

## 3. Build the harness, install the local plugin, and start the source Web

Install dependencies and build deepseek-harness first:

```powershell
Set-Location $env:DSH_HARNESS_ROOT
pnpm install
pnpm run build
```

Then return to the plugin source root and run:

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm run profile:add
```

The command invokes the official source CLI through `DSH_HARNESS_ROOT` and dynamically passes the host/UI package directories from the current checkout. It does not depend on a fixed path.

Finally, start the source Web profile:

```powershell
Set-Location $env:DSH_HARNESS_ROOT
pnpm dsh web
```

Go to Settings > Plugins and check the MCP server tab.

## 4. Local regression

This repository's build and regression commands do not require the harness source checkout:

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm run check
pnpm exec node e2e/e2e.mjs
pnpm exec node e2e/apply-remove-settle.mjs
```

Expected markers: `ALL PASS`, `E2E PASS`, and `SETTLE PASS`.

## 5. Remove the local profile entries

Stop the Web process first, then run from the plugin source root:

```powershell
pnpm run profile:remove
```

## Build commands

Run all commands from this repository root:

```powershell
pnpm install
pnpm run build
pnpm run verify
```

`build`, `gen.mjs`, and `verify.mjs` use the published npm dependencies and do not require `DSH_HARNESS_ROOT` or a deepseek-harness source checkout. Only `profile:add` and `profile:remove` use that variable to invoke the official source CLI.

After changing wire types in `src/types.ts`, rerun `pnpm run build` so the generated Typert artifacts and client codec stay synchronized.

Placeholder meanings:

- `<deepseek-harness-source-root>`: the root directory of the deepseek-harness source checkout.
- `<dsh-mcp-mgr-source-root>`: the root directory of this plugin source checkout.

See the [design notes](requirements.md) for implementation details.
