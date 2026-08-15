# dsh-mcp-mgr

[English](README.md) | 中文

dsh 的工作区级 MCP 管理器：在每个工作区的 `.dsh/dshmm/mcp.json`（类 Claude/Codex 的 `mcpServers` 格式）中声明 MCP server，自动发现并动态注册为 dsh 插件实例，并提供设置页管理界面。

## 功能

- **工作区 MCP**：自动发现已登记工作区的 `mcp.json`，变更热同步，工作区删除自动卸载
- **Profile MCP 展示**：配置树中（profile patch / bundle / `--patch`）的 mcp-client 注册只读展示，含真实状态、跨来源冲突提示、来源文件一键打开
- **设置页 Tab**：服务列表（状态徽章、来源标注、宽度自适应表格）；工作区来源可移除，配置来源可查看来源文件
- 工具以 `mcp__<serverName>__<tool>` 命名注册，多 server / 多来源天然隔离

## 安装

```sh
dsh plugin --profile web add dsh-mcp-mgr
```

> 需已安装 dsh CLI，并已初始化目标 profile: 参考 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)

卸载：`dsh plugin --profile web remove dsh-mcp-mgr`

## 工作区配置

工作区根目录下的 `.dsh/dshmm/mcp.json`：

```json
{
  "mcpServers": {
    "unity-mcp": { "type": "http", "url": "http://localhost:8090/" },
    "filesystem": { "type": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"] }
  }
}
```

- `type` 缺省视为远程 Streamable HTTP；支持 `${VAR}` 环境变量展开
- stdio server 的 cwd 默认为工作区根目录
- serverName 全局唯一，冲突时后加载者报错（UI 标冲突）

## 开发

构建相关：

```sh
# host 插件
tsc -p packages/dsh-mcp-mgr && node gen.mjs

# UI 插件（ui 包目录）
tsc -p packages/dsh-mcp-mgr-ui && tsdown --config-loader tsx --env.DSH_BUILD_FACE client

# 回归
node verify.mjs
```

本地（源码）安装验证与卸载：

```sh
node scripts/install.mjs

# 卸载：node scripts/uninstall.mjs
```

设计文档见 `Doc/requirements.md`。
