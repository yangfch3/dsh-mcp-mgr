# dsh-mcp-mgr 源码开发者指南

[English](development.md) | 中文

适用于同时修改 deepseek-harness 和本插件源码的场景。两个仓库可以位于任意目录，不要求同级或固定路径。

## 1. 一次配置 harness 源码位置

把路径占位符替换成实际的 deepseek-harness 源码绝对路径后执行一次：

```powershell
[Environment]::SetEnvironmentVariable('DSH_HARNESS_ROOT', '<deepseek-harness-source-root>', 'User')
```

重新打开终端。该变量只用于本地 profile 安装/卸载，不参与本仓库的构建和回归。

## 2. 构建本插件

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm install
pnpm run check
```

`check` 包含 host/client 构建、Typert 生成和 `verify` 回归。

## 3. 构建 harness、安装本地插件并启动 source Web

先安装并构建 deepseek-harness：

```powershell
Set-Location $env:DSH_HARNESS_ROOT
pnpm install
pnpm run build
```

再回到本插件源码根目录执行：

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm run profile:add
```

该命令会从 `DSH_HARNESS_ROOT` 调用官方 source CLI，并根据当前 checkout 位置动态安装本仓库的 host/UI 包，不依赖固定路径。

最后启动 source Web：

```powershell
Set-Location $env:DSH_HARNESS_ROOT
pnpm dsh web
```

去到设置 > 插件，检查 MCP 服务页签是否正常工作。

## 4. 本地回归

本仓库的构建和回归不需要 harness source：

```powershell
Set-Location '<dsh-mcp-mgr-source-root>'
pnpm run check
pnpm exec node e2e/e2e.mjs
pnpm exec node e2e/apply-remove-settle.mjs
```

成功标准：`ALL PASS`、`E2E PASS`、`SETTLE PASS`。

## 5. 清理本地 profile

先停止 Web，再在本插件源码根目录执行：

```powershell
pnpm run profile:remove
```

## 构建命令

以下命令均在本仓库根目录执行：

```powershell
pnpm install
pnpm run build
pnpm run verify
```

`build`、`gen.mjs` 和 `verify.mjs` 使用正式 npm 依赖，不需要 `DSH_HARNESS_ROOT` 或 deepseek-harness source。只有 `profile:add` / `profile:remove` 使用该变量调用官方 source CLI。

改动 `src/types.ts` 的 wire 字段后必须重新运行 `pnpm run build`，以同步 Typert 产物和客户端 codec。

占位符说明：

- `<deepseek-harness-source-root>`：deepseek-harness 源码仓库根目录。
- `<dsh-mcp-mgr-source-root>`：本插件源码仓库根目录。

设计说明见 [`requirements.md`](requirements.md)。
