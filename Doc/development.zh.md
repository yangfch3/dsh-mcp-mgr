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

## 发布

发布由 tag 驱动：推送 `vX.Y.Z` tag 是版本进入 npm 的唯一途径，因此不会出现"发了包没打 tag"。

1. 把 `packages/dsh-mcp-mgr/package.json` 和 `packages/dsh-mcp-mgr-ui/package.json` 的 `version` 一起改掉（含两处互相依赖的版本号），执行 `pnpm install` 刷新 lockfile，然后提交。
2. 打 tag 并推送：`git tag -a vX.Y.Z -m "vX.Y.Z"`，再 `git push --follow-tags`（裸 `git push` 不会推 tag）。
3. `.github/workflows/release.yml` 会安装依赖、跑 `pnpm run check`、按 `dsh-mcp-mgr-ui` → `dsh-mcp-mgr` 顺序带 `--provenance` 发布、校验两个包，并创建 GitHub release。

预发布 tag（`vX.Y.Z-rc.1`）会发到 `next` dist-tag 并标记为 GitHub prerelease，`latest` 保持在稳定版本上。可以先在 Actions → release → Run workflow 手动跑一次（dry run，只做安装/构建/回归，不发布）确认 runner 没问题，再打第一个正式 tag。

一次性配置，两个包各做一次（npmjs.com → 该包 → Settings → Trusted publishing → GitHub Actions）：owner 填 `yangfch3`、repository 填 `dsh-mcp-mgr`、workflow filename 填 `release.yml`、environment 留空。不需要任何 npm token 或仓库 secret —— workflow 的 `id-token: write` 权限负责 OIDC 认证，同时生成 provenance。tag 与两个包的版本不一致时 job 会在发布前失败；registry 上已存在的版本会被跳过，所以失败后可以直接重跑。

注意 npm 的两个行为：还没成功发布过的 trusted publishing 配置会在 48 小时后失效（错过了就重建一个）；本地没有 token，因此本地 `npm publish` 不再能认证，发布只能在 CI 里发生。万一必须手工发布，npm 现在只提供 granular token，且要勾上 **Bypass 2FA** 才能免交互，写权限 token 最长 90 天有效。

两个 `package.json` 必须保留指向本仓库的 `repository` 字段：npm 会拿它和 provenance 里的仓库信息比对，缺失或指向别的仓库时发布会被拒（`422 Unprocessable Entity - Error verifying sigstore provenance bundle`）。

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
