# dsh-mcp-mgr 需求文档

> 状态：**组 1 + 组 2 已实现并通过本地验证**（spike 结论已落地）

## 背景

dsh 目前的 MCP 接入只有一条路径：`@deepseek-ai/dsh-mcp-client` 插件，一个实例 = 一个 MCP server，配置在 cordis patch 层（profile 级 `cordis.patch.yml` / home 级 / `--patch`），且该插件不在默认 bundle 里，需手动安装 + 手写 yml。没有任何项目/工作区级配置机制，也没有 CLI / GUI 管理入口（已验证，证据见会话记录）。

## 目标

- **插件组 1（核心，host 插件）**：工作区目录下 `.dsh/dshmm/mcp.json`（类 Claude/Codex 的 `mcpServers` 格式），dsh 载入工作区时自动发现并动态注册其中所有 MCP server；文件变更热同步；工作区删除时卸载。
- **插件组 2（web UI 插件，仅 web profile）**：在 dsh 设置页中展示与管理由组 1 注册的 MCP：列表、状态、增删改、来源工作区标注、冲突提示。

## 实现状态（2026-08-15）

```
packages/dsh-mcp-mgr/      组1 host 插件（已实现 + 验证）
  src/{index,parse,sync,discovery,watch,types}.ts
  lib/typert.{host,remote-client}.js    Remote 产物（mcpMgr: snapshot/apply/remove）
packages/dsh-mcp-mgr-ui/   组2 client 插件（已实现 + 构建）
  src/{index.ts, client/{index.ts,McpSettingsTab.tsx,locales.ts}}
  lib/client.js            浏览器 bundle（__ModuleLoader__ closure，145KB）
packages/vendor-typert-protocol/   vendored protocol 源码（S1 约束）
packages/{platform,tsdown.client}.ts   client 构建基础设施（从 dsh 复刻）
gen.mjs / verify.mjs / e2e/   生成 + 单测 + 真实 MCP server 端到端
```

- **验证覆盖**：解析/${VAR}展开/拒绝路径；sync 生命周期（创建/重建/删除/冲突/失败/工作区移除）；Remote 产物 strict codec + 真实 Typert registry 挂载；**真实 mcp-client + 真实 stdio MCP server 端到端**（`e2e/e2e.mjs`，连接→active→mcp.json 变更→重建）
- **已知未验证**：真实 dsh web profile 中的 UI 渲染与 roster 加载（需本地 dsh web 环境）；组 1 在 web profile 下经 workspaceRegistry 的多工作区并集（e2e 仅覆盖 headless cwd 路径）
- **构建命令**：`tsc -p packages/dsh-mcp-mgr` → `node gen.mjs`；`tsc -p packages/dsh-mcp-mgr-ui` → `tsdown --config-loader tsx --env.DSH_BUILD_FACE client`（ui 包目录）

## 总体设计

```
mcp.json (每个工作区 .dsh/dshmm/)
    │ 发现（启动全量 + watch + 周期重扫）
    ▼
mcp-mgr host 插件 (组1)
    │ 解析/校验/映射
    ├─ ctx.plugin(mcp-client, config)  → Fiber  每个 server 一个实例
    │ 增删改时 dispose 旧 Fiber / 挂新 Fiber
    ▼
ctx.tools (host 全局)  ← 所有 session 可见

组2 web UI: slots 注册 settings 分区 tab → 经通道读写组1状态
```

## 关键决策（已定）

| 决策 | 结论 |
|---|---|
| 工作区语义 | **并集**：注册所有已登记工作区的 mcp.json（headless 退化为 `process.cwd()` 单点） |
| 通道路线 | **通道①（自建 Typert Remote）可行**（S1 已验证，代价：vendor protocol 源码 + workspace 布局）；② settings 通道仍可作轻量备选 |
| 格式映射 | `mcpServers` → mcp-client config 直译；支持 `${VAR}` env 展开；Claude `type: http` → `transport: streamable-http` |
| stdio server cwd | **必须显式传工作区根路径**（`cwd:''` 会落到 host 进程目录，S3） |

## 机制限制（dsh 现状约束）

1. **工具是 host 全局的**：`ctx.tools` 为 app 级，MCP 工具对全部 session 可见，无法按 session/工作区过滤 —— 这是并集方案的根因。
2. **`workspaceRegistry` 无事件**：创建/删除工作区不发出任何事件，组 1 需自建同步兜底（watch 各工作区目录 + 周期重扫）。
3. **mcp-client 不在 base bundle**：组 1 自行声明 `@deepseek-ai/dsh-mcp-client` 依赖即可，用户无需单独安装。
4. **serverName 全局唯一**：不同工作区同名 server 会按 mcp-client 既有契约报错（不静默覆盖）；UI 需展示冲突状态。
5. **headless 无 workspaceRegistry**：只能按 cwd 发现，多项目并存场景（如 host 进程内）不支持。

## 待验证路线（spike 清单）

- [x] **S1 树外 Typert 生成**：✅ 已验证可行（`spike/` 下最小插件包 `dsh-spike-remote`，脱离仓库 tsdown+`DSH_BUILD_FACE` 接线，直接调 `WorkspaceTypertGenerator` 生成 `typert.host.js` + `typert.remote-client.js`，并通过真实 Typert registry 挂载 + codec 收发验证）。**两个硬约束**：
  1. analyzer 的 `isTypeMetaSymbol` 只识别 workspace 内 registration 的符号 → `@Remote`/`TypertRemoteService` 必须来自本仓库 packages/ 下的包 → **插件仓库必须 vendor 一份 `@deepseek-ai/dsh-typert-protocol` 源码**（复制 src 即可，协议包无额外运行时依赖）
  2. 插件仓库根需 `tsconfig.host.json`（workspace root marker）+ `packages/<pkg>/` 布局（analyzer 要求包在 `root/packages` 内）
- [x] **S2 `dsh.client` roster**：✅ 加载链路确认。扫描源是 `ctx.loader.entries()`（cordis 配置树），包经 profile 目录的 node_modules 解析（`ctx.baseUrl` 锚点），声明 `dsh.client` + exports `./client` 即进入 `window.__DSH_BOOT__`，浏览器经 `/plugins/<id>/client.js` 拉取。树外 client 插件 = profile patch 加一行 `- id: xxx / name: <pkg>` + `dsh plugin add` 安装
- [x] **S3 `mcp-client` cwd 语义**：✅ `config.cwd: ''` 与缺省等价，MCP SDK 原样传给 Node `spawn`，子进程继承 **host 进程** cwd（实测）→ mcp.json 的 stdio server 必须显式传工作区根路径
- [ ] **S4 同步触发点**：设计确认项（非 spike）：watch + 周期重扫即可，settings 通道写入路径在组 1 实现时确定（chokidar 先例已确认）

## 已实现（2026-08-15 追加）

- **非工作区来源 MCP 展示**：host 扫描 `ctx.loader.entries()` 中 mcp-client 注册（profile patch / bundle / --patch），按 fiber 状态映射 active/error/configured，跨来源 serverName 冲突标 conflict，来源文件经 `cordis.patch.yml` 内容探测（`packages/dsh-mcp-mgr/src/profile.ts`）；UI 只读展示（来源列 + chip + 行底色区分，操作列"查看"经 `connection.api.host.openPath` 打开来源文件）
- **表格 UI 调整**：来源路径自适应缩短（末一段，同名补末两段；profile 行固定末两段）+ hover 全路径；`table-layout: fixed` 列宽（服务/传输/状态/操作不再折行）；移除按钮红字 ghost
- **npm 用户安装（bundle 路线）**：`dsh-mcp-mgr` 声明 `dsh.bundle`（patch 引 host + ui 两行），ui 包作其依赖；`@deepseek-ai/*` 全部 peer 化（含补漏的 `@deepseek-ai/schemastery`），配合 profile 的 `nodeLinker: hoisted` + `autoInstallPeers: false`，运行时复用 dsh 内置包、无 registry 副本。已在临时 DSH_HOME 用真实 `dsh plugin add` + `--dump-config` + 单实例冒烟全链路验证

## 发布与安装（npm 用户）

```sh
# 发布（顺序：先 ui 后 mgr，mgr 的依赖里引用 ui）
cd packages/dsh-mcp-mgr-ui && npm publish
cd ../dsh-mcp-mgr && npm publish

# 用户安装（等价于 scripts/install.mjs 的线上版）
dsh plugin --profile web add dsh-mcp-mgr@latest dsh-mcp-mgr-ui@latest

# 因为 pnpm 的发布年龄限制，最新发布的版本需要满足 dsh 配置的最小年龄才可拉取最新版本
# 如需即刻使用，可等待过发布年龄或强行执行版本号
# dsh plugin --profile web add dsh-mcp-mgr@x.x.x dsh-mcp-mgr-ui@x.x.x

```

卸载：`dsh plugin --profile web remove dsh-mcp-mgr`。当前 `scripts/install.mjs` 保留给源码开发环境。

## 未来扩展（本期不做）

- workspaceRegistry 事件（给 dsh 提 PR，消除周期重扫）
- per-session 工具过滤（需 dsh 核心支持）
- Resources / Prompts 桥接（mcp-client 本身未实现）
- 非工作区来源 MCP 的写回管理（移除/编辑 profile patch 条目）
- CLI 管理命令（`dsh mcp` 子命令）
- 自定义 serverName 前缀策略（替代并集冲突报错）

## 非目标

- 不改 dsh 核心/不动仓库内 api-remotes 装配（除非 S1 证明树外路线不可行）
- 不实现 MCP server 的下载/安装/认证（沿用 mcp-client 的职责边界）
